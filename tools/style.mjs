#!/usr/bin/env node
// Leigh's style for the TypeScript and JavaScript code.
//
//     node tools/style.mjs            rewrite the files in place
//     node tools/style.mjs --check    only list files that would change (exit 1 if any)
//     node tools/style.mjs --verify   prove the last run changed formatting only (see below)
//
// What it does, outside strings, templates, regexes and comments only:
//   0. A block written on one line ("{ a(); b(); }", a one-line function body, try / catch) opens up
//      so its braces sit on their own lines, and each statement gets its own line.
//   1. Joins a statement that was split over several lines when it fits on one (160 characters).
//   2. 4 spaces per indent level (the code was 2).
//   3. An opening brace, bracket or parenthesis is never the last thing on a line: it moves to its own
//      line ("if (x) {" becomes "if (x)" and "{"). Not after return / throw / yield, where a line break
//      would change what the code does.
//   4. "} else {", "} catch (e) {", "} finally {" become separate lines.
//   5. A blank line after a closing brace, unless the next line closes something too or carries on.
//   6. Statements next to each other that start differently (const/let, if, return, await, loops,
//      everything else) get a blank line between them. A comment stays with the line below it.
//
// Proof: --verify parses every file before (from git, HEAD) and after, drops positions, and compares
// the syntax trees. Formatting-only changes leave them identical.
//
// ESLint isn't used: typescript-eslint doesn't support the TypeScript version this repo uses, and
// Prettier can't do braces on their own line. This script is the one place the style lives.

import { parse } from "@babel/parser";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX = 160;
const OPENERS = "{[(";
const CLOSERS = "}])";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DIRS = ["src", "site", "test"];

function parseFile(text, file)
{
    const plugins = file.endsWith(".ts") ? ["typescript"] : [];

    return parse(text, { sourceType: "unambiguous", plugins, tokens: true, errorRecovery: false, allowReturnOutsideFunction: true });
}

// true for characters that are code, false inside strings, templates, regexes and comments
function codeMask(text, ast)
{
    const mask = new Array(text.length).fill(true);
    const off = (a, b) =>
    {
        for (let k = a; k < b; k++) mask[k] = false;
    };

    for (const c of ast.comments) off(c.start, c.end);

    for (const t of ast.tokens)
    {
        const l = t.type && t.type.label;

        if (l === "string" || l === "regexp" || l === "template" || l === "templateNonTail" || l === "templateTail" || l === "`") off(t.start, t.end);
    }

    // whole template literals, including their ${...} parts, stay untouched
    walk(ast.program, (n) =>
    {
        if (n.type === "TemplateLiteral") off(n.start, n.end);
    });

    return mask;
}

function walk(node, fn, parent = null)
{
    if (!node || typeof node.type !== "string") return;

    if (fn(node, parent) === false) return;

    for (const key of Object.keys(node))
    {
        if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "extra") continue;

        const v = node[key];

        if (Array.isArray(v)) v.forEach((c) => walk(c, fn, node));
        else if (v && typeof v.type === "string") walk(v, fn, node);
    }
}

// ---- 0. a block written on one line gets its braces on their own lines

// Which one-line blocks open up: any with two or more statements, function bodies, and try / catch / finally.
function opensUp(node, parent)
{
    if (node.type !== "BlockStatement" || node.loc.start.line !== node.loc.end.line || !node.body.length) return false;
    if (node.body.length >= 2) return true;

    return /Function/.test(parent?.type || "") || parent?.type === "TryStatement" || parent?.type === "CatchClause";
}

function expandBlocks(text, file)
{
    for (let round = 0; round < 2000; round++)
    {
        const ast = parseFile(text, file);
        let hit = null;

        walk(ast.program, (node, parent) =>
        {
            if (hit) return false;
            if (opensUp(node, parent) && !(ast.comments || []).some((c) => c.start > node.start && c.end < node.end)) hit = node;
        });

        if (!hit) return text;

        const lineStart = text.lastIndexOf("\n", hit.start - 1) + 1;
        const indent = /^[ \t]*/.exec(text.slice(lineStart))[0];
        const lineEnd = text.indexOf("\n", hit.end) === -1 ? text.length : text.indexOf("\n", hit.end);
        const body = hit.body.map((st) => indent + "    " + text.slice(st.start, st.end)).join("\n");
        let rest = text.slice(hit.end, lineEnd);

        // what followed the block: ";" or ")" stay on the closing line, else/catch/finally are split later,
        // anything else goes on its own line
        if (rest.trim() && !/^[;,)\]]/.test(rest) && !/^\s*(else|catch|finally|while)\b/.test(rest)) rest = "\n" + indent + rest.trim();

        text = text.slice(0, hit.start).trimEnd() + "\n" + indent + "{\n" + body + "\n" + indent + "}" + rest + text.slice(lineEnd);
    }

    throw new Error("expandBlocks did not settle");
}

// One statement per line: "const a = x; const b = y;" becomes two lines.
function splitStatements(text, file)
{
    const ast = parseFile(text, file);
    const cuts = [];

    walk(ast.program, (node) =>
    {
        const list = node.type === "Program" || node.type === "BlockStatement" ? node.body : node.type === "SwitchCase" ? node.consequent : null;

        if (!list) return;

        for (let i = 1; i < list.length; i++)
        {
            if (list[i].loc.start.line === list[i - 1].loc.end.line) cuts.push(list[i].start);
        }
    });

    for (const at of cuts.sort((a, b) => b - a))
    {
        const lineStart = text.lastIndexOf("\n", at - 1) + 1;
        const indent = /^[ \t]*/.exec(text.slice(lineStart))[0];

        text = text.slice(0, at).trimEnd() + "\n" + indent + text.slice(at);
    }

    return text;
}

// ---- 1. join split statements

const JOINABLE = new Set(["ExpressionStatement", "VariableDeclaration", "ReturnStatement", "ThrowStatement"]);

function joinStatements(text, file)
{
    const ast = parseFile(text, file);
    const edits = [];

    walk(ast.program, (n) =>
    {
        if (!JOINABLE.has(n.type)) return;

        const src = text.slice(n.start, n.end);

        if (!src.includes("\n")) return false;

        let blocked = false;

        walk(n, (c) =>
        {
            if (c.type === "BlockStatement" || c.type === "TemplateLiteral" || c.type === "ClassBody") blocked = true;
        });

        if (blocked || ast.comments.some((c) => c.start >= n.start && c.end <= n.end)) return false;

        const toks = ast.tokens.filter((t) => t.start >= n.start && t.end <= n.end);
        let out = "";

        for (let i = 0; i < toks.length; i++)
        {
            const t = toks[i];
            const value = text.slice(t.start, t.end);
            const next = toks[i + 1];

            // a trailing comma right before a closer goes (it only existed for the line break)
            if (value === "," && next && ")]}".includes(text.slice(next.start, next.end)) && text.slice(t.end, next.start).includes("\n")) continue;

            out += value;

            if (!next) break;

            const gap = text.slice(t.end, next.start);
            const nv = text.slice(next.start, next.end);

            if (!gap.includes("\n")) out += gap;
            else if (value === "(" || value === "[" || nv === ")" || nv === "]" || nv === "," || nv === "." || nv === "?.") out += "";
            else out += " ";
        }

        const lineStart = text.lastIndexOf("\n", n.start - 1) + 1;
        const indent = text.slice(lineStart, n.start);

        if (/^ *$/.test(indent) && indent.length * 2 + out.length <= MAX) edits.push([n.start, n.end, out]);

        return false;
    });

    edits.sort((a, b) => b[0] - a[0]);

    for (const [a, b, s] of edits) text = text.slice(0, a) + s + text.slice(b);

    return text;
}

// ---- line helpers

function lines(text, file)
{
    const ast = parseFile(text, file);
    const mask = codeMask(text, ast);
    const out = [];
    let start = 0;

    for (let i = 0; i <= text.length; i++)
    {
        if (i === text.length || text[i] === "\n")
        {
            out.push({ text: text.slice(start, i), mask: mask.slice(start, i), start });
            start = i + 1;
        }
    }

    return { list: out, ast };
}

const indentOf = (s) => s.length - s.trimStart().length;

function lastCode(l)
{
    for (let k = l.text.length - 1; k >= 0; k--)
    {
        if (l.mask[k] && l.text[k] !== " " && l.text[k] !== "\t") return k;
    }

    return -1;
}

function firstChar(l)
{
    const k = indentOf(l.text);

    if (k >= l.text.length) return null;

    return l.mask[k] ? l.text[k] : null;
}

function isComment(l)
{
    const k = indentOf(l.text);

    return k < l.text.length && !l.mask[k];
}

// ---- 2. 4-space indents

function reindent(text, file)
{
    const { list } = lines(text, file);

    // only files still on 2 spaces (so running this again changes nothing)
    const steps = list.filter((l) => l.text.trim() && l.mask[0] !== false).map((l) => indentOf(l.text)).filter((n) => n > 0);

    if (!steps.some((n) => n % 4 === 2)) return text;

    return list.map((l) =>
    {
        // lines that start inside a string, template or block comment keep their spacing
        if (!l.text.trim() || (l.mask.length && !l.mask[0] && !l.text.trimStart().startsWith("//") && !l.text.trimStart().startsWith("/*"))) return l.text;

        const n = indentOf(l.text);

        return " ".repeat(n * 2) + l.text.slice(n);
    }).join("\n");
}

// ---- 3 and 4. openers on their own line, closers before else / catch / finally

function moveOpeners(text, file)
{
    for (;;)
    {
        const { list, ast } = lines(text, file);
        const out = [];

        for (const l of list)
        {
            const ind = " ".repeat(indentOf(l.text));
            const last = lastCode(l);
            const m = /^(\s*)\}\s+((else|catch|finally)\b.*)$/.exec(l.text);

            if (m && l.mask[m[1].length])
            {
                out.push(ind + "}", ind + m[2]);
                continue;
            }

            if (last < 0)
            {
                out.push(l.text);
                continue;
            }

            let k = last;

            while (k >= 0 && l.mask[k] && OPENERS.includes(l.text[k])) k--;

            const run = l.text.slice(k + 1, last + 1);
            const after = l.text.slice(last + 1).trim();

            // only when nothing but a // comment follows (not a string or template that carries on)
            if (after && !after.startsWith("//"))
            {
                out.push(l.text);
                continue;
            }

            const head = l.text.slice(0, k + 1).trimEnd();

            // never after return / throw / yield: a line break there changes what the code does
            const before = ast.tokens.filter((t) => t.end <= l.start + k + 1 && t.end > l.start).pop();
            const word = before ? text.slice(before.start, before.end) : "";

            if (run && head.trim() && !["return", "throw", "yield"].includes(word))
            {
                const tail = l.text.slice(last + 1).trim();

                out.push(head + (tail ? " " + tail : ""), ind + run);
            }
            else out.push(l.text);
        }

        const next = out.join("\n");

        if (next === text) return text;

        text = next;
    }
}

// ---- 5 and 6. blank lines

function kind(s)
{
    s = s.trim();

    for (const [w, g] of [["const", "decl"], ["let", "decl"], ["var", "decl"], ["if", "if"], ["return", "return"], ["await", "await"], ["for", "loop"], ["while", "loop"], ["do", "loop"], ["switch", "switch"], ["try", "try"]])
    {
        if (s === w || s.startsWith(w + " ") || s.startsWith(w + "(")) return g;
    }

    return "other";
}

function blankLines(text, file)
{
    const { list } = lines(text, file);
    const out = [];

    for (let i = 0; i < list.length; i++)
    {
        const l = list[i];
        const s = l.text.trim();

        // rule 6: a different kind of statement than the one above, same indent, same block
        if (s && !isComment(l) && !CLOSERS.includes(firstChar(l)) && !OPENERS.includes(firstChar(l)))
        {
            const ind = indentOf(l.text);
            let j = out.length - 1;
            let top = out.length;

            while (j >= 0 && out[j].text.trim() && isComment(out[j]))
            {
                top = j;
                j--;
            }

            let prev = null;

            if (j >= 0 && out[j].text.trim())
            {
                const p = out[j];
                const pc = lastCode(p);
                const ends = pc >= 0 && ";}".includes(p.text[pc]);

                if (indentOf(p.text) === ind && ends && !CLOSERS.includes(firstChar(p))) prev = kind(p.text);
                else if (indentOf(p.text) === ind && ends)
                {
                    // the statement above ends on a closer line ("]);", ").bind(x);"): find where it started
                    let q = j;

                    while (q >= 0 && (!out[q].text.trim() || indentOf(out[q].text) > ind || (indentOf(out[q].text) === ind && "{[()]}".includes(firstChar(out[q]) || "x")))) q--;

                    if (q >= 0 && indentOf(out[q].text) === ind && !isComment(out[q])) prev = kind(out[q].text);
                }
                else if (indentOf(p.text) > ind && ends)
                {
                    let q = j;

                    while (q >= 0 && (!out[q].text.trim() || indentOf(out[q].text) > ind)) q--;

                    if (q >= 0 && indentOf(out[q].text) === ind && !isComment(out[q]) && !CLOSERS.includes(firstChar(out[q]))) prev = kind(out[q].text);
                }
            }

            if (prev !== null && prev !== kind(l.text)) out.splice(top, 0, { text: "", mask: [] });
        }

        out.push(l);

        // rule 5: after a line that only closes things
        const n = list[i + 1];

        if (n && n.text.trim() && s && CLOSERS.includes(firstChar(l)) && /^[}\])][}\])()]*[;,]?$/.test(s))
        {
            const ns = n.text.trim();

            if (!CLOSERS.includes(firstChar(n)) && !/^(while\b|\.|\?\.|\?|:|=>|as\b|,|\{)/.test(ns)) out.push({ text: "", mask: [] });
        }
    }

    // tidy: no double blanks, none right after an opener or right before a closer
    const res = [];

    for (let i = 0; i < out.length; i++)
    {
        const t = out[i].text;

        if (!t.trim())
        {
            const prev = res[res.length - 1];
            const next = out.slice(i + 1).find((x) => x.text.trim());

            if (!prev || !prev.trim() || ["{", "[", "(", "({", "[{"].includes(prev.trim()) || !next || CLOSERS.includes(next.text.trim()[0])) continue;

            res.push("");
            continue;
        }

        res.push(t.trimEnd());
    }

    return res.join("\n").replace(/\n*$/, "\n");
}

function style(text, file)
{
    text = expandBlocks(text, file);
    text = splitStatements(text, file);
    text = joinStatements(text, file);
    text = reindent(text, file);
    text = moveOpeners(text, file);
    text = blankLines(text, file);

    return text;
}

// ---- proof: same syntax tree before and after

function tree(text, file)
{
    const ast = parseFile(text, file);
    const strip = (v) =>
    {
        if (Array.isArray(v)) return v.map(strip);

        if (!v || typeof v !== "object") return v;

        const o = {};

        for (const k of Object.keys(v))
        {
            if (["start", "end", "loc", "range", "extra", "tokens", "leadingComments", "trailingComments", "innerComments"].includes(k)) continue;

            o[k] = strip(v[k]);
        }

        return o;
    };

    return JSON.stringify({ program: strip(ast.program), comments: ast.comments.map((c) => c.value.trim().replace(/\s+/g, " ")) });
}

function files()
{
    const out = [];

    for (const d of DIRS)
    {
        const dir = path.join(ROOT, d);

        if (!fs.existsSync(dir)) continue;

        for (const f of fs.readdirSync(dir, { recursive: true }))
        {
            const full = path.join(dir, String(f));

            if (/\.(ts|js|mjs)$/.test(full) && !full.includes("node_modules") && !full.endsWith(".d.ts")) out.push(full);
        }
    }

    for (const f of ["vitest.config.ts"]) if (fs.existsSync(path.join(ROOT, f))) out.push(path.join(ROOT, f));

    return out;
}

const mode = process.argv[2] || "";
let changed = 0;
let bad = 0;

for (const file of files())
{
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, "utf8");

    if (mode === "--verify")
    {
        let before;

        try
        {
            before = execFileSync("git", ["show", "HEAD:" + rel], { cwd: ROOT, encoding: "utf8" });
        }
        catch
        {
            continue;
        }

        if (tree(before, file) !== tree(text, file))
        {
            console.log("SYNTAX TREE DIFFERS: " + rel);
            bad++;
        }

        continue;
    }

    let after;

    try
    {
        after = style(text, file);
    }
    catch (e)
    {
        console.log("COULD NOT STYLE " + rel + ": " + e.message);
        bad++;
        continue;
    }


    if (after !== text)
    {
        changed++;
        console.log((mode === "--check" ? "would change: " : "styled: ") + rel);

        if (mode !== "--check") fs.writeFileSync(file, after);
    }
}

if (mode === "--verify") console.log(bad ? bad + " file(s) changed more than formatting" : "Formatting only: every syntax tree matches HEAD.");

if ((mode === "--check" && changed) || bad) process.exit(1);
