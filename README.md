# Flipbook Library (Zero-Maintenance & 100% Free)

A static flipbook website for GitHub Pages that automatically scans its own repository structure to render books.

No external databases, no Google Cloud Storage, and no billing setups required!

## How it works

1. You run `convert.py` locally to convert a PDF into high-res WebP page images.
2. You commit and push the generated book folder to GitHub.
3. The home page automatically scans the `books/` folder on GitHub, reads the books, and lists them on the site.

**No manual registry file updates (`books.json`) and no team conflicts!**

---

## Initial Setup (Do this once)

### Configure your repository name
Open [config.json](file:///Users/Poker/Downloads/files/config.json) and enter your GitHub repository owner and name:
```json
{
  "github_repo": "your-github-username/your-repository-name"
}
```
Commit and push this change to GitHub.

---

## How to Add a Book (Daily Workflow)

1. **Double-click `convert.command`** in your project folder.
2. Drag and drop your PDF file and press **Enter**.
3. It will generate a folder inside `books/` (e.g. `books/chemistry/`) containing:
   - `meta.json` (book info)
   - `pages/` (high-res WebP pages)
4. Commit and push the new files to GitHub.

The book is immediately live on your website! The home page (`index.html`) will automatically scan it and display it.
