import base64
import io
import os
from datetime import datetime
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from reportlab.pdfgen import canvas
import requests

app = FastAPI(title="Signature Auto Care PDF Service", version="0.1.0")

NODE_ENV = os.getenv("NODE_ENV")

def require_env(name: str, fallback: str) -> str:
  value = os.getenv(name, fallback)
  if not value and NODE_ENV == "production":
    raise RuntimeError(f"{name} is required in production")
  return value

JWT_SECRET = require_env("JWT_SECRET", "dev-secret")
API_URL = require_env("API_URL", "http://localhost:3001")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*")
ALLOWED_ORIGINS = [origin.strip() for origin in CORS_ORIGINS.split(",") if origin.strip()] or ["*"]

app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS != ["*"] else ["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


def verify_token(authorization: str | None = Header(default=None)):
  if not authorization:
    raise HTTPException(status_code=401, detail="Missing bearer token")
  if not authorization.startswith("Bearer "):
    raise HTTPException(status_code=401, detail="Missing bearer token")
  token = authorization.split(" ", 1)[1]
  try:
    jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
  except JWTError:
    raise HTTPException(status_code=401, detail="Invalid token")
  return token


def build_pdf(title: str, lines: list[str]) -> bytes:
  buffer = io.BytesIO()
  pdf = canvas.Canvas(buffer)
  pdf.setTitle(title)
  pdf.setFont("Helvetica-Bold", 16)
  pdf.drawString(40, 800, title)
  pdf.setFont("Helvetica", 11)
  y = 770
  for line in lines:
    pdf.drawString(40, y, line)
    y -= 18
    if y < 40:
      pdf.showPage()
      pdf.setFont("Helvetica", 11)
      y = 780
  pdf.showPage()
  pdf.save()
  buffer.seek(0)
  return buffer.read()

def format_money(value: float | int | None) -> str:
  try:
    num = float(value or 0)
  except (TypeError, ValueError):
    num = 0.0
  return f"Tk. {num:,.2f}"

def fetch_profit_report(from_date: str | None, to_date: str | None, token: str) -> dict | None:
  params = {}
  if from_date:
    params["from"] = from_date
  if to_date:
    params["to"] = to_date
  try:
    res = requests.get(
      f"{API_URL}/reports/profit",
      params=params,
      headers={"Authorization": f"Bearer {token}"},
      timeout=10
    )
    if res.ok:
      return res.json()
    return {"error": f"API error {res.status_code}: {res.text}"}
  except requests.RequestException as exc:
    return {"error": f"API request failed: {exc}"}

@app.get("/health")
def health():
  return {"ok": True}


@app.post("/pdf/invoice")
def invoice_pdf(payload: dict, _=Depends(verify_token)):
  invoice_no = payload.get("invoiceNumber", "INV")
  customer = payload.get("customerName", "Customer")
  lines = [f"Invoice: {invoice_no}", f"Customer: {customer}", f"Created: {datetime.utcnow()}"]
  for item in payload.get("lineItems", []):
    label = item.get("description", "Item")
    qty = item.get("quantity", 1)
    price = item.get("unitPrice", 0)
    lines.append(f"{label} x{qty} @ {price} = {qty * price}")
  pdf_bytes = build_pdf(f"Invoice {invoice_no}", lines)
  return {"base64": base64.b64encode(pdf_bytes).decode("utf-8")}


@app.get("/reports/profit-pdf")
def profit_pdf(from_date: str | None = None, to_date: str | None = None, token: str = Depends(verify_token)):
  report = fetch_profit_report(from_date, to_date, token)
  lines = [
    "Profit Report",
    f"Range: {from_date or 'start'} - {to_date or 'now'}"
  ]
  if report and "error" in report:
    lines.append(f"Error: {report.get('error')}")
  elif report:
    lines.extend([
      f"Revenue: {format_money(report.get('revenue'))}",
      f"COGS: {format_money(report.get('cogs'))}",
      f"Expenses: {format_money(report.get('expenses'))}",
      f"Gross Profit: {format_money(report.get('grossProfit'))}",
      f"Net: {format_money(report.get('netProfit'))}",
    ])
  else:
    lines.append("Error: Report data unavailable")
  pdf_bytes = build_pdf("Profit Report", lines)
  return {"base64": base64.b64encode(pdf_bytes).decode("utf-8")}
