# Flipbook Library

A zero-configuration static flipbook library for GitHub Pages. Just drop your PDFs in a folder and they're published automatically.

## How to Publish

1. Create a folder named `PDFs/` in your repository root.
2. Put your PDF files in it (e.g. `PDFs/biology.pdf`).
3. Push the changes to GitHub.
4. Open your GitHub Pages link (e.g. `https://username.github.io/repository/`).

The home page (`index.html`) will automatically detect all PDFs in your `PDFs/` folder and list them. Clicking a card opens that PDF in the interactive page-turning flipbook viewer.

## Optional: Custom Metadata (books.json)

If you want to customize titles, authors, categories, or covers instead of using the defaults, you can optionally create or update `books.json` in your repository root:

```json
[
  {
    "file": "biology.pdf",
    "title": "Introduction to Biology",
    "author": "Dr. Jane Doe",
    "category": "Science",
    "cover": "covers/biology.png"
  }
]
```

## Viewer controls

- **Next page**: `→` / `↓` / `Page Down`
- **Prev page**: `←` / `↑` / `Page Up`
- **First page**: `Home`
- **Last page**: `End`
- **Fullscreen**: `F`
- **Zoom in/out**: `+` / `-`
- **Zoom to page**: Double-click page
- **Close zoom**: `Esc` or click overlay

## Project structure

```
/
├── index.html          Library home page (auto-detects PDFs)
├── viewer.html         Universal flipbook viewer page
├── books.json          Optional metadata configuration
├── PDFs/               Add your PDF files here
├── css/                Styling
├── js/                 Library and Viewer controllers
└── libs/               PDF.js + StPageFlip library
```
