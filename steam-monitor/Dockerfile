FROM python:3.12-alpine

WORKDIR /app
COPY app.py steam_client.py ./

ENV STEAM_DATA_DIR=/app/data \
    STEAM_PORT=8091 \
    STEAM_REFRESH_SEC=300 \
    PYTHONUNBUFFERED=1

EXPOSE 8091
CMD ["python", "-u", "app.py"]
