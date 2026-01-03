from reportlab.pdfgen import canvas
import sys

def create_pdf(filename):
    c = canvas.Canvas(filename)
    c.drawString(100, 750, "SVU Campus Connect Test Document")
    c.drawString(100, 730, "This is a dummy PDF created for verifying the Admin Upload feature.")
    c.drawString(100, 710, "Secret Key: SECRET_TEST_VALUE_12345")
    c.save()
    print(f"Created {filename}")

if __name__ == "__main__":
    create_pdf("dummy_test.pdf")
