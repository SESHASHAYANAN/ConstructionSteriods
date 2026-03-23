# ConstructAI — AI-Powered QA/QC Platform for AEC Engineering Documents

An agentic AI pipeline for automated review of construction engineering drawings, specifications, and project documents.

## Architecture

```
/frontend   — React + Vite UI (file upload, live review progress, NCR/RFI logs)
/backend    — Python FastAPI (agentic AI pipeline, REST API, PDF report generation)
```

### Agentic Pipeline

```
Upload → OCR Agent (Gemini Vision) → Analysis Agents (Groq LLaMA) → Report Agent → NCR/RFI Generation
```

| Agent | Model | Purpose |
|-------|-------|---------|
| **OCR / Vision Agent** | Google Gemini 2.5 Flash Lite | Extract text + visual QA from engineering drawings |
| **Speed Agent** | Groq LLaMA 3 70B | Fast checklist screening of extracted content |
| **Reasoning Agent** | Groq LLaMA 3.3 70B Versatile | Deep code compliance + coordination review |
| **Summary Agent** | Groq LLaMA 3.3 70B Versatile | Executive summary generation |
| **Report Agent** | FPDF2 | PDF report with findings, severity breakdown |

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp ../.env.example .env      # Fill in API keys
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` → Login with `admin@constructai.com` / `admin123`

## Environment Variables

Copy `.env.example` to `backend/.env` and fill in:

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key for LLaMA models |
| `GEMINI_API_KEY` | Google Gemini API key for vision/OCR |
| `JWT_SECRET` | Secret key for JWT token signing |

## Features

- **Multi-format upload**: PDF, DOCX, XLSX engineering documents
- **Live SSE progress**: Real-time agent progress streaming
- **Auto NCR/RFI generation**: Critical/Major → NCR, Minor → RFI
- **PDF report export**: Comprehensive findings report with executive summary
- **Spec generation**: AI-generated CSI MasterFormat specifications
- **Rate limiting**: Exponential backoff with jitter for API rate limits

## License

Private — all rights reserved.
