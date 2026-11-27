# سامانه مالیار — استقرار با داکر روی پورت 8099
# ساخت از ریشه مخزن:  docker build -t maliyar -f deploy/Dockerfile .
# اجرا:               docker run -d -p 8099:8099 -v maliyar-data:/data --name maliyar maliyar
FROM python:3.12-slim

WORKDIR /app
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend /app/backend
COPY frontend/dist /app/frontend/dist

ENV SAMANE_DB=/data/samane.db \
    SAMANE_UPLOADS=/data/uploads

WORKDIR /app/backend
EXPOSE 8099
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8099"]
