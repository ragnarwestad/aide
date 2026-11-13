# Page changes

## Table of contents

- [What changes in place](#what-changes-in-place)
- [Pages shown before their answer](#pages-shown-before-their-answer)
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

A row's › on the Running tab or the Specs list asks the page's own address for that one row. The server builds
that row alone, so the answer does not take longer as the list grows, and the page replaces that row and nothing
else. [The row, open and shut](the-specs-list.md#the-row-open-and-shut) says what the row shows.

## Pages shown before their answer

The browser tab remembers each dashboard page it has drawn. Following a plain link, or using Back or Forward,
shows a remembered page at once while a fresh page is fetched. The page cover appears after its normal delay while
the fresh page is on its way. The fresh answer then replaces the remembered page without moving the reader's place
in the window or in a scrolled list.

The remembered page is the page as it stood when the reader left it, including rows redrawn since it was first
loaded. Its controls remain active, and the server checks a press against the current state as usual. Automatic
updates wait until the fresh page has replaced it.

A page with a form for reader-entered values is not remembered. Copies live only in the browser tab's memory and
are discarded when the tab is closed or loaded again. Actions that save or change something fetch their result
without showing a remembered page first.

## Address, history and scroll

The address bar and page title follow the content. Back and Forward show a remembered page when there is one and
fetch a fresh page for their address. A different page starts at the top. An action that refreshes the same page
keeps its scroll position.

The browser loads the address normally in these cases:

- the request fails;
- the answer is not a dashboard page;
- the service has restarted since the current page was loaded. Every page carries the time its service started,
  so after a Deploy the first page change brings in the new service's script as well.

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
