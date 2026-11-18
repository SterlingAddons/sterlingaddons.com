// Sterling site: screenshot tabs, copy buttons and live version numbers. Works without it too.
"use strict";

// The zip or installer each repo publishes, by version.
const FILES =
{
    SterlingQuest: (version) => `Sterling-${version}.zip`,
    SterlingLoot: (version) => `SterlingLoot-${version}.zip`,
    SterlingHunter: (version) => `SterlingHunter-${version}.zip`,
    "SterlingQuestSync-App": (version) => `SterlingQuestSync_${version}_x64-setup.exe`,
};

// Screenshot tabs: show one panel at a time, arrow keys move between tabs.
function setupGallery(gallery)
{
    const tabs = [...gallery.querySelectorAll("[role=tab]")];

    function select(tab)
    {
        for (const other of tabs)
        {
            const on = other === tab;

            other.setAttribute("aria-selected", String(on));
            other.tabIndex = on ? 0 : -1;
            document.getElementById(other.getAttribute("aria-controls")).hidden = !on;
        }
    }

    for (const tab of tabs)
    {
        tab.addEventListener("click", () => select(tab));
        tab.addEventListener("keydown", (event) =>
        {
            const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;

            if (!step) return;

            const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];

            next.focus();
            select(next);
        });
    }

    select(tabs[0]);
}

// Copy buttons for the WowUp links.
function setupCopy(button)
{
    button.addEventListener("click", async () =>
    {
        try
        {
            await navigator.clipboard.writeText(button.dataset.copy);

            button.textContent = "Copied";
            button.classList.add("done");
        }

        catch
        {
            button.textContent = "Select it";
        }

        setTimeout(() =>
        {
            button.textContent = "Copy";
            button.classList.remove("done");
        }, 2000);
    });
}

// Screenshots open full size in a pop-up. Click anywhere, the X or Escape closes it. Without JavaScript the link opens the picture.
function setupZoom(box)
{
    const picture = box.querySelector("img");
    const caption = box.querySelector(".lb-cap");

    for (const link of document.querySelectorAll("a.zoom"))
    {
        link.addEventListener("click", (event) =>
        {
            const shot = link.querySelector("img");

            event.preventDefault();
            picture.src = link.href;
            picture.alt = shot.alt;
            caption.textContent = shot.alt;
            box.showModal();
        });
    }

    box.addEventListener("click", () => box.close());
    box.addEventListener("close", () => picture.removeAttribute("src"));
}

// Newest versions from the site's own /api/versions (the Worker reads GitHub). The numbers in the page stay if it fails.
async function loadVersions()
{
    let versions;

    try
    {
        const response = await fetch("/api/versions");

        if (!response.ok) return;

        versions = await response.json();
    }

    catch
    {
        return;
    }

    for (const badge of document.querySelectorAll(".ver[data-repo]"))
    {
        const version = versions[badge.dataset.repo];

        if (!version) continue;

        badge.textContent = `v${version}`;
        badge.classList.add("live");
    }

    for (const link of document.querySelectorAll("a[data-download]"))
    {
        const repo = link.dataset.download;
        const version = versions[repo];

        if (!version || !FILES[repo]) continue;

        link.href = `https://github.com/SterlingAddons/${repo}/releases/download/v${version}/${FILES[repo](version)}`;
    }
}

document.querySelectorAll("[data-gallery]").forEach(setupGallery);
document.querySelectorAll("button[data-copy]").forEach(setupCopy);
document.querySelectorAll("dialog.lightbox").forEach(setupZoom);
loadVersions();
