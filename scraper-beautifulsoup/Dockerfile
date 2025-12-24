# Use official Python slim base
FROM python:3.11-slim

# Avoid prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies for BeautifulSoup and requests
RUN apt-get update && apt-get install -y \
    gcc \
    libxml2-dev \
    libxslt1-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8001

# Run the application
CMD ["uvicorn", "scrape:app", "--host", "0.0.0.0", "--port", "8001"]
