import docx, sys, os
src = r"C:\Users\David\Dropbox\Hudson Group\Ensuites on Tow\Wheelie Bathrooms\hire Agreement"
out = os.path.join(os.path.dirname(__file__), "source")
for f, o in [("WB Terms and Conditions.docx","terms.txt"),("WB Privacy Policy.docx","privacy.txt"),("WB Hire Agreement DRAFT.docx","hire-agreement.txt")]:
    d = docx.Document(os.path.join(src, f))
    open(os.path.join(out, o), "w", encoding="utf-8").write("\n".join(p.text for p in d.paragraphs if p.text.strip()))
