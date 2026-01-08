FROM python:3.11-slim

WORKDIR /app

COPY apps/py/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/py/main.py ./main.py

ENV PORT=8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
