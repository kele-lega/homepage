FROM python:3.12-alpine
WORKDIR /app
RUN pip install --no-cache-dir bcrypt==4.3.0
COPY auth.py .
EXPOSE 8080
CMD ["python", "-u", "auth.py"]
