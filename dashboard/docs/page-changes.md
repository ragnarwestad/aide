# Page changes

## Table of contents

- [What changes in place](#what-changes-in-place)
- [Address, history and scroll](#address-history-and-scroll)
- [Forms and slow answers](#forms-and-slow-answers)
- [What the browser still handles](#what-the-browser-still-handles)

---

## What changes in place

A plain link to another dashboard page fetches that page and replaces the notices and main content. The existing
header and top menu stay in the document, but their labels, controls and selected tab are updated from the answer.
The same page setup runs for the new content, and the setup for the replaced content is stopped first.

Successful actions that end on another dashboard page use the same page change. This includes creating a spec,
adding or removing a project, saving project settings, completing an action dialog and saving a schedule.

## Address, history and scroll

The address bar and page title follow the content. Back and Forward fetch and show the page for their address.
A different page starts at the top. An action that refreshes the same page keeps its scroll position.

If the request fails or its answer is not a dashboard page, the browser loads the address normally.

## Forms and slow answers

A page change asks before replacing a form with unsaved changes. The question uses the dashboard's leave dialog;
staying keeps both the form and its address.

The page cover appears after the normal delay while an answer is on its way. It closes when the new content has
been put in place.

## What the browser still handles

The browser handles links that:

- lead to another site;
- open a new tab or window;
- download a file;
- use `mailto:`, `tel:` or an address fragment;
- are clicked with a modifier key or a mouse button other than the primary one.

Recovery after a lost connection, a service restart, a wait page and a timed page reload also remain full page
loads.
