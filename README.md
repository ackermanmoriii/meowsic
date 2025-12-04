# YT Music Streamer — Prototype

## Overview
This repository contains a prototype streaming app that searches YouTube (via yt-dlp),
streams audio through a Flask backend, and uses a mobile-first frontend with MSE and a Service Worker.

## Quick start (development)
1. Create a Python virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate
   pip install -r backend/requirements.txt
