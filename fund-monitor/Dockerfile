# 只用 Python 标准库，无需 pip 安装依赖
FROM python:3.12-alpine

WORKDIR /app
COPY app.py data_source.py ./

# 数据目录由 compose 挂载到宿主机，保证重启后基金列表不丢
ENV FUND_DATA_DIR=/app/data \
    FUND_PORT=8090 \
    FUND_REFRESH_SEC=60 \
    PYTHONUNBUFFERED=1

EXPOSE 8090
CMD ["python", "-u", "app.py"]
