FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc libreoffice-impress fonts-liberation libseccomp2 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10002 preview && useradd -u 10002 -g preview -M preview
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py convert.py ./
ENV PYTHONUNBUFFERED=1
# The coordinator holds credentials. The untrusted decoder runs as uid 10002,
# with a clean environment, no network sockets, and no access to /proc/root.
CMD ["python", "worker.py"]
