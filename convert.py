import os
import fitz  # PyMuPDF
import json

def convert_pdf_to_webp(pdf_path, output_dir, dpi=150):
    # Open the PDF document
    doc = fitz.open(pdf_path)
    book_slug = os.path.splitext(os.path.basename(pdf_path))[0].lower().replace(" ", "_")
    
    # Create output directories
    target_dir = os.path.join(output_dir, book_slug)
    pages_dir = os.path.join(target_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    
    print(f"Starting conversion of '{pdf_path}' at {dpi} DPI...")
    
    # Render pages
    zoom = dpi / 72  # 72 is the default PDF DPI
    matrix = fitz.Matrix(zoom, zoom)
    
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        pix = page.get_pixmap(matrix=matrix)
        
        # If image has an alpha (transparency) channel, convert to RGB for JPG format
        if pix.alpha:
            pix = fitz.Pixmap(fitz.csRGB, pix)
            
        # Save as JPG with 85% quality (excellent sharpness with tiny file sizes)
        output_file = os.path.join(pages_dir, f"{page_num + 1}.jpg")
        pix.save(output_file, jpg_quality=85)
        print(f"Rendered page {page_num + 1}/{len(doc)}")

    # 1. Extract PDF Bookmarks / Table of Contents (TOC)
    index_list = []
    try:
        toc = doc.get_toc()
        for item in toc:
            # item format: [level, title, page_num]
            index_list.append({
                "title": item[1],
                "page": item[2]
            })
    except Exception as e:
        print(f"Could not extract table of contents: {e}")

    # Generate metadata file
    meta = {
        "slug": book_slug,
        "title": book_slug.replace("_", " ").title(),
        "pages": len(doc),
        "extension": "jpg",
        "index": index_list,
        "created": int(fitz.time_now() * 1000) if hasattr(fitz, "time_now") else 0
    }
    
    with open(os.path.join(target_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    print(f"\nDone! Output saved to: {target_dir}")
    print(f"\nNext Steps:\n1. Commit the newly generated folder to your GitHub repository.")
    print(f"2. Push to GitHub, and it will automatically go live on your website library!")

if __name__ == "__main__":
    pdf = input("Enter PDF file path: ").strip().strip('"').strip("'")
    convert_pdf_to_webp(pdf, "./books")
