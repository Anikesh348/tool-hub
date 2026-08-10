from __future__ import annotations

import hashlib
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Dict

from fastapi import HTTPException
from pymongo import ASCENDING, DESCENDING

from app.services.ai_provider_router import routed_gateway_request
from app.services.mongo import col
from app.utils.responses import jsonable, now_iso


COURSES = "courses"
MODULES = "course_modules"
QUESTIONS = "course_questions"
PROGRESS = "course_progress"
SEED_ROOT = Path(__file__).resolve().parent.parent / "seed" / "courses"
MAX_SELECTION = 4000
MAX_SURROUNDING_CONTEXT = 6000
MAX_QUESTION = 2000
AI_CONTEXT_BUDGET = 7000
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
logger = logging.getLogger(__name__)

CONTEXT_STOP_WORDS = {
    "about", "after", "again", "also", "and", "are", "can", "could", "does",
    "explain", "for", "from", "have", "how", "into", "module", "more", "that",
    "the", "this", "what", "when", "where", "which", "with", "would", "you",
}

LINUX_MODULE_SEEDS = (
    {
        "slug": "how-linux-works",
        "position": 1,
        "title": "How Linux works — a useful mental model",
        "duration": "3–4 hours",
        "excerpt": "Kernel versus user space, programs and processes, shells, identity, and your homelab boundaries.",
        "section": "Mental Model & Shell",
        "file": "01-how-linux-works.md",
    },
    {
        "slug": "shell-commands-without-guesswork",
        "position": 2,
        "title": "The shell — commands without guesswork",
        "duration": "6–8 hours",
        "excerpt": "Navigate, inspect, transform, quote, redirect, and compose commands safely.",
        "section": "Mental Model & Shell",
        "file": "02-shell-commands-without-guesswork.md",
    },
    {
        "slug": "linux-directory-tree",
        "position": 3,
        "title": "The Linux directory tree — where things belong",
        "duration": "5–6 hours",
        "excerpt": "Understand the single filesystem tree, important directories, links, mounts, and NFS-backed media paths.",
        "section": "Filesystem & Permissions",
        "file": "03-linux-directory-tree.md",
    },
    {
        "slug": "users-groups-permissions",
        "position": 4,
        "title": "Users, groups and permissions",
        "duration": "8–10 hours",
        "excerpt": "Reason about UID/GID, mode bits, sudo, Docker ownership, NFS identity, ACLs, and diagnosis.",
        "section": "Filesystem & Permissions",
        "file": "04-users-groups-permissions.md",
    },
    {
        "slug": "foundation-review",
        "position": 5,
        "title": "Foundation review and next steps",
        "duration": "1–2 hours",
        "excerpt": "Test the mental model, review essential commands, and prepare for services, networking, storage, and Docker.",
        "section": "Review",
        "file": "05-foundation-review.md",
    },
)

INTEGRATION_MODULE_SEEDS = (
    {
        "slug": "capabilities-and-system-goals",
        "position": 1,
        "title": "Capabilities, goals and non-goals",
        "duration": "45–60 minutes",
        "excerpt": "What the integration can do today, what each capability profile permits, and the deliberate boundaries.",
        "section": "Goals & Architecture",
        "file": "01-capabilities-and-system-goals.md",
    },
    {
        "slug": "high-level-architecture",
        "position": 2,
        "title": "High-level architecture and ownership",
        "duration": "60–75 minutes",
        "excerpt": "Follow requests across the browser, ToolHub, gateway, executor, Codex CLI, and their persistence boundaries.",
        "section": "Goals & Architecture",
        "file": "02-high-level-architecture.md",
    },
    {
        "slug": "contract-and-request-security",
        "position": 3,
        "title": "Provider-neutral contract and request security",
        "duration": "75–90 minutes",
        "excerpt": "REST schemas, HMAC signing, scopes, source restrictions, timestamps, nonces, and replay protection.",
        "section": "Security & Gateway Design",
        "file": "03-contract-and-request-security.md",
    },
    {
        "slug": "codex-gateway-low-level-design",
        "position": 4,
        "title": "Codex gateway — low-level design",
        "duration": "75–90 minutes",
        "excerpt": "Validation, prompt assembly, runtime snapshots, concurrency, audit records, errors, and executor adaptation.",
        "section": "Security & Gateway Design",
        "file": "04-codex-gateway-low-level-design.md",
    },
    {
        "slug": "hp-codex-executor-wrapper",
        "position": 5,
        "title": "hp-codex executor and Codex CLI wrapper",
        "duration": "90–120 minutes",
        "excerpt": "The private execution API, fixed CLI command, sanitized environment, profiles, event parsing, timeouts, and process isolation.",
        "section": "Security & Gateway Design",
        "file": "05-hp-codex-executor-wrapper.md",
    },
    {
        "slug": "toolhub-application-integration",
        "position": 6,
        "title": "ToolHub application integration",
        "duration": "90–120 minutes",
        "excerpt": "Admin authorization, chat persistence, background execution, course context retrieval, polling, and frontend behavior.",
        "section": "Application Integration",
        "file": "06-toolhub-application-integration.md",
    },
    {
        "slug": "operations-reliability-and-review",
        "position": 7,
        "title": "Operations, reliability and design review",
        "duration": "75–90 minutes",
        "excerpt": "Systemd hardening, private networking, health, failure modes, observability, rollback, trade-offs, and future providers.",
        "section": "Operations & Case Study",
        "file": "07-operations-reliability-and-review.md",
    },
    {
        "slug": "leetcode-ai-a-second-application",
        "position": 8,
        "title": "LeetCode AI — a second application on the same gateway",
        "duration": "75–90 minutes",
        "excerpt": "A real second feature built on the same gateway and router: isolated persistence, a dedicated executor, slug re-resolution against LeetCode, and the public-path timeout that forced the background+poll rewrite.",
        "section": "Operations & Case Study",
        "file": "08-leetcode-ai-a-second-application.md",
    },
)

HLD_INTERVIEW_MODULE_SEEDS = (
    {
        "slug": "interview-answering-framework",
        "position": 1,
        "title": "How to answer a system design interview problem",
        "duration": "45–60 minutes",
        "excerpt": "The seven-stage framework — requirements, scale estimation, API/data model, high-level design, deep dive, trade-offs, summary — that every later lesson in this course applies to a specific problem.",
        "section": "Interview Framework",
        "file": "01-interview-answering-framework.md",
    },
    {
        "slug": "design-url-shortener",
        "position": 2,
        "title": "Design a URL Shortener (like TinyURL)",
        "duration": "60–75 minutes",
        "excerpt": "Short-code generation strategies — counter plus base62 versus hashing versus a pre-generated pool — and staying unique under concurrent writes.",
        "section": "Easy",
        "file": "02-design-url-shortener.md",
    },
    {
        "slug": "design-autocomplete",
        "position": 3,
        "title": "Design Autocomplete for a Search Engine",
        "duration": "60–75 minutes",
        "excerpt": "Trie-based prefix matching, ranking top-K suggestions, and keeping a massive trie fresh as query popularity shifts.",
        "section": "Easy",
        "file": "03-design-autocomplete.md",
    },
    {
        "slug": "design-load-balancer",
        "position": 4,
        "title": "Design a Load Balancer",
        "duration": "60–75 minutes",
        "excerpt": "L4 versus L7 balancing, load-balancing algorithms from round robin to consistent hashing, and health checking.",
        "section": "Easy",
        "file": "04-design-load-balancer.md",
    },
    {
        "slug": "design-cdn",
        "position": 5,
        "title": "Design a Content Delivery Network (CDN)",
        "duration": "60–75 minutes",
        "excerpt": "Push versus pull CDN models, cache invalidation across edge nodes, and routing users to the nearest edge.",
        "section": "Easy",
        "file": "05-design-cdn.md",
    },
    {
        "slug": "design-parking-garage",
        "position": 6,
        "title": "Design a Parking Garage",
        "duration": "60–75 minutes",
        "excerpt": "An object-oriented and system design hybrid: spot allocation, concurrent assignment across multiple entrances, and ticketing/pricing.",
        "section": "Easy",
        "file": "06-design-parking-garage.md",
    },
    {
        "slug": "design-vending-machine",
        "position": 7,
        "title": "Design a Vending Machine",
        "duration": "60–75 minutes",
        "excerpt": "Modeling the system as a finite state machine across idle, selecting, payment, dispensing and error states, with inventory/payment consistency.",
        "section": "Easy",
        "file": "07-design-vending-machine.md",
    },
    {
        "slug": "design-distributed-key-value-store",
        "position": 8,
        "title": "Design a Distributed Key-Value Store",
        "duration": "60–75 minutes",
        "excerpt": "Consistent hashing for partitioning, replication, and quorum reads/writes with tunable N, W and R.",
        "section": "Easy",
        "file": "08-design-distributed-key-value-store.md",
    },
    {
        "slug": "design-distributed-cache",
        "position": 9,
        "title": "Design a Distributed Cache",
        "duration": "60–75 minutes",
        "excerpt": "Partitioning hot keys across cache nodes, eviction policies, and keeping a cache consistent with the source of truth.",
        "section": "Easy",
        "file": "09-design-distributed-cache.md",
    },
    {
        "slug": "design-authentication-system",
        "position": 10,
        "title": "Design an Authentication System",
        "duration": "60–75 minutes",
        "excerpt": "Session tokens versus JWTs, secure password storage, and a high-level walk through OAuth and multi-factor flows.",
        "section": "Easy",
        "file": "10-design-authentication-system.md",
    },
    {
        "slug": "design-upi-payments",
        "position": 11,
        "title": "Design a Unified Payments Interface (UPI)-style system",
        "duration": "75–90 minutes",
        "excerpt": "Idempotency for money transfers and hold/debit/credit sequencing across bank accounts without double-spending under partial failure.",
        "section": "Medium",
        "file": "11-design-upi-payments.md",
    },
    {
        "slug": "design-whatsapp",
        "position": 12,
        "title": "Design WhatsApp",
        "duration": "75–100 minutes",
        "excerpt": "Real-time delivery over long-lived connections, per-conversation ordering, delivery/read receipts, offline queuing, and encryption at a high level.",
        "section": "Medium",
        "file": "12-design-whatsapp.md",
    },
    {
        "slug": "design-spotify",
        "position": 13,
        "title": "Design Spotify",
        "duration": "75–100 minutes",
        "excerpt": "Audio chunking and streaming, CDN placement for audio files, the playlist/recommendation data model, and client-side offline caching.",
        "section": "Medium",
        "file": "13-design-spotify.md",
    },
    {
        "slug": "design-instagram",
        "position": 14,
        "title": "Design Instagram",
        "duration": "75–100 minutes",
        "excerpt": "News feed generation — fan-out on write versus fan-out on read, and the hybrid needed for celebrity accounts — plus image storage and feed ranking.",
        "section": "Medium",
        "file": "14-design-instagram.md",
    },
    {
        "slug": "design-notification-service",
        "position": 15,
        "title": "Design a Notification Service",
        "duration": "75–100 minutes",
        "excerpt": "Multi-channel push/email/SMS fan-out, per-user rate limiting, retries and deduplication, and priority queuing.",
        "section": "Medium",
        "file": "15-design-notification-service.md",
    },
    {
        "slug": "design-distributed-job-scheduler",
        "position": 16,
        "title": "Design a Distributed Job Scheduler",
        "duration": "75–100 minutes",
        "excerpt": "Leader election for scheduling, exactly-once-ish execution guarantees, and handling worker failure with safe retries.",
        "section": "Medium",
        "file": "16-design-distributed-job-scheduler.md",
    },
    {
        "slug": "design-tinder",
        "position": 17,
        "title": "Design Tinder",
        "duration": "75–100 minutes",
        "excerpt": "Geospatial indexing for nearby-user matching, swipe/match consistency, and real-time match notification.",
        "section": "Medium",
        "file": "17-design-tinder.md",
    },
    {
        "slug": "design-facebook",
        "position": 18,
        "title": "Design Facebook",
        "duration": "75–100 minutes",
        "excerpt": "Storing a social graph at scale, friend-of-friend queries, and feed ranking and fan-out trade-offs.",
        "section": "Medium",
        "file": "18-design-facebook.md",
    },
    {
        "slug": "design-twitter",
        "position": 19,
        "title": "Design Twitter / X",
        "duration": "75–100 minutes",
        "excerpt": "Fan-out on write versus read for timelines, the celebrity-account hot-spot problem, and tweet storage at scale.",
        "section": "Medium",
        "file": "19-design-twitter.md",
    },
    {
        "slug": "design-reddit",
        "position": 20,
        "title": "Design Reddit",
        "duration": "75–100 minutes",
        "excerpt": "Hot/top ranking with score decay over time, nested comment tree storage and pagination, and vote counting without hot-row contention.",
        "section": "Medium",
        "file": "20-design-reddit.md",
    },
    {
        "slug": "design-netflix",
        "position": 21,
        "title": "Design Netflix",
        "duration": "75–100 minutes",
        "excerpt": "The video transcoding pipeline, adaptive bitrate streaming, and CDN pre-positioning of on-demand catalog content.",
        "section": "Medium",
        "file": "21-design-netflix.md",
    },
    {
        "slug": "design-youtube",
        "position": 22,
        "title": "Design YouTube",
        "duration": "75–100 minutes",
        "excerpt": "Resumable chunked upload and transcoding for user-generated video, plus view-count and recommendation data flow at a high level.",
        "section": "Medium",
        "file": "22-design-youtube.md",
    },
    {
        "slug": "design-google-search",
        "position": 23,
        "title": "Design Google Search",
        "duration": "75–100 minutes",
        "excerpt": "Web crawling at scale, inverted index construction, and ranking with link analysis plus relevance scoring.",
        "section": "Medium",
        "file": "23-design-google-search.md",
    },
    {
        "slug": "design-ecommerce-store",
        "position": 24,
        "title": "Design an E-commerce Store (like Amazon)",
        "duration": "75–100 minutes",
        "excerpt": "Product catalog search, inventory consistency that prevents overselling under concurrent purchases, and a saga-style checkout workflow.",
        "section": "Medium",
        "file": "24-design-ecommerce-store.md",
    },
    {
        "slug": "design-tiktok",
        "position": 25,
        "title": "Design TikTok",
        "duration": "75–100 minutes",
        "excerpt": "The 'For You' recommendation feed pipeline at a conceptual level, video upload/transcoding, and pre-fetching for smooth scroll.",
        "section": "Medium",
        "file": "25-design-tiktok.md",
    },
    {
        "slug": "design-shopify",
        "position": 26,
        "title": "Design Shopify",
        "duration": "75–100 minutes",
        "excerpt": "Multi-tenant data isolation strategies, per-store customization, and serving storefronts with wildly different traffic levels.",
        "section": "Medium",
        "file": "26-design-shopify.md",
    },
    {
        "slug": "design-airbnb",
        "position": 27,
        "title": "Design Airbnb",
        "duration": "75–100 minutes",
        "excerpt": "Geospatial plus availability-date search, booking consistency that prevents double-booked dates, and dynamic pricing data flow.",
        "section": "Medium",
        "file": "27-design-airbnb.md",
    },
    {
        "slug": "design-rate-limiter",
        "position": 28,
        "title": "Design a Rate Limiter",
        "duration": "75–100 minutes",
        "excerpt": "Token bucket, leaky bucket, fixed and sliding window algorithms compared, and distributed rate limiting with shared counters.",
        "section": "Medium",
        "file": "28-design-rate-limiter.md",
    },
    {
        "slug": "design-distributed-message-queue",
        "position": 29,
        "title": "Design a Distributed Message Queue (like Kafka)",
        "duration": "75–100 minutes",
        "excerpt": "Partitioning and per-partition ordering guarantees, consumer groups and offset tracking, and replication for durability.",
        "section": "Medium",
        "file": "29-design-distributed-message-queue.md",
    },
    {
        "slug": "design-flight-booking-system",
        "position": 30,
        "title": "Design a Flight Booking System",
        "duration": "75–100 minutes",
        "excerpt": "Seat inventory consistency under high concurrency, multi-airline fare search, and booking holds with timeouts.",
        "section": "Medium",
        "file": "30-design-flight-booking-system.md",
    },
    {
        "slug": "design-online-code-editor",
        "position": 31,
        "title": "Design an Online Code Editor",
        "duration": "75–100 minutes",
        "excerpt": "Sandboxed, resource-bounded code execution and the execution/judging queue behind a collaborative coding platform.",
        "section": "Medium",
        "file": "31-design-online-code-editor.md",
    },
    {
        "slug": "design-analytics-platform",
        "position": 32,
        "title": "Design an Analytics Platform (metrics and logging)",
        "duration": "75–100 minutes",
        "excerpt": "A high-throughput event ingestion pipeline, time-series storage with downsampling/rollups, and query-time aggregation trade-offs.",
        "section": "Medium",
        "file": "32-design-analytics-platform.md",
    },
    {
        "slug": "design-payment-system",
        "position": 33,
        "title": "Design a Payment System",
        "duration": "75–100 minutes",
        "excerpt": "Idempotency keys for retried requests, the state machine of a charge's lifecycle, and reconciliation with external payment networks.",
        "section": "Medium",
        "file": "33-design-payment-system.md",
    },
    {
        "slug": "design-digital-wallet",
        "position": 34,
        "title": "Design a Digital Wallet",
        "duration": "75–100 minutes",
        "excerpt": "Double-entry ledger design as the consistency backbone, and atomic, idempotent debit/credit transfers between wallets.",
        "section": "Medium",
        "file": "34-design-digital-wallet.md",
    },
    {
        "slug": "design-location-based-service",
        "position": 35,
        "title": "Design a Location-Based Service (like Yelp)",
        "duration": "90–120 minutes",
        "excerpt": "Geospatial indexing at scale with geohashing/quadtrees, combining location filtering with text search, and keeping the index fresh.",
        "section": "Hard",
        "file": "35-design-location-based-service.md",
    },
    {
        "slug": "design-uber",
        "position": 36,
        "title": "Design Uber",
        "duration": "90–120 minutes",
        "excerpt": "Ingesting real-time driver location at massive scale, rider-driver matching, and surge pricing data flow.",
        "section": "Hard",
        "file": "36-design-uber.md",
    },
    {
        "slug": "design-food-delivery-app",
        "position": 37,
        "title": "Design a Food Delivery App (like DoorDash)",
        "duration": "90–120 minutes",
        "excerpt": "Three-sided marketplace matching across customer, restaurant and driver, the order state machine, and real-time ETA computation.",
        "section": "Hard",
        "file": "37-design-food-delivery-app.md",
    },
    {
        "slug": "design-google-docs",
        "position": 38,
        "title": "Design Google Docs",
        "duration": "90–120 minutes",
        "excerpt": "Operational transformation versus CRDTs for conflict-free concurrent edits, and low-latency edit propagation across clients.",
        "section": "Hard",
        "file": "38-design-google-docs.md",
    },
    {
        "slug": "design-google-maps",
        "position": 39,
        "title": "Design Google Maps",
        "duration": "90–120 minutes",
        "excerpt": "Road-network graph storage and shortest-path routing at scale, and folding live traffic into route calculation.",
        "section": "Hard",
        "file": "39-design-google-maps.md",
    },
    {
        "slug": "design-zoom",
        "position": 40,
        "title": "Design Zoom",
        "duration": "90–120 minutes",
        "excerpt": "SFU versus MCU versus P2P mesh architectures for real-time media routing, and handling jitter and packet loss.",
        "section": "Hard",
        "file": "40-design-zoom.md",
    },
    {
        "slug": "design-file-sharing-system",
        "position": 41,
        "title": "Design a File Sharing System (like Dropbox)",
        "duration": "90–120 minutes",
        "excerpt": "Chunking large files for efficient delta sync, and resolving conflicts when the same file is edited offline on two devices.",
        "section": "Hard",
        "file": "41-design-file-sharing-system.md",
    },
    {
        "slug": "design-ticket-booking-system",
        "position": 42,
        "title": "Design a Ticket Booking System (like BookMyShow)",
        "duration": "90–120 minutes",
        "excerpt": "Seat-level inventory locking under flash-sale demand, and preventing double-booking with short-lived holds.",
        "section": "Hard",
        "file": "42-design-ticket-booking-system.md",
    },
    {
        "slug": "design-distributed-web-crawler",
        "position": 43,
        "title": "Design a Distributed Web Crawler",
        "duration": "90–120 minutes",
        "excerpt": "URL frontier management with per-domain politeness, duplicate URL/content detection, and distributing crawl work without overlap.",
        "section": "Hard",
        "file": "43-design-distributed-web-crawler.md",
    },
    {
        "slug": "design-code-deployment-system",
        "position": 44,
        "title": "Design a Code Deployment System",
        "duration": "90–120 minutes",
        "excerpt": "Blue-green, canary and rolling rollout strategies with automatic rollback triggers, and build artifact storage/versioning.",
        "section": "Hard",
        "file": "44-design-code-deployment-system.md",
    },
    {
        "slug": "design-distributed-cloud-storage",
        "position": 45,
        "title": "Design a Distributed Cloud Storage system (like S3)",
        "duration": "90–120 minutes",
        "excerpt": "Durability trade-offs between replication and erasure coding, and consistent metadata management for object listing at massive scale.",
        "section": "Hard",
        "file": "45-design-distributed-cloud-storage.md",
    },
    {
        "slug": "design-distributed-locking-service",
        "position": 46,
        "title": "Design a Distributed Locking Service",
        "duration": "90–120 minutes",
        "excerpt": "Consensus (Paxos/Raft) as the basis for correctness, and leases plus fencing tokens to survive lock-holder failure without split-brain.",
        "section": "Hard",
        "file": "46-design-distributed-locking-service.md",
    },
)

HLD_FUNDAMENTALS_MODULE_SEEDS = (
    {
        "slug": "core-concepts",
        "position": 1,
        "title": "Core Concepts",
        "duration": "90–120 minutes",
        "excerpt": "Scalability, availability, reliability, single points of failure, latency/throughput/bandwidth, consistent hashing, the CAP theorem, failover, and fault tolerance — the vocabulary every later module builds on.",
        "section": "Core Concepts",
        "file": "01-core-concepts.md",
    },
    {
        "slug": "networking-fundamentals",
        "position": 2,
        "title": "Networking Fundamentals",
        "duration": "90–120 minutes",
        "excerpt": "The OSI model, IP addresses, DNS, proxies versus reverse proxies, HTTP/HTTPS, TCP versus UDP, load-balancing algorithms, and checksums.",
        "section": "Communication & APIs",
        "file": "02-networking-fundamentals.md",
    },
    {
        "slug": "api-fundamentals",
        "position": 3,
        "title": "API Fundamentals",
        "duration": "90–120 minutes",
        "excerpt": "What an API is, API gateways, REST versus GraphQL, WebSockets, webhooks, idempotency, rate limiting, and API design best practices.",
        "section": "Communication & APIs",
        "file": "03-api-fundamentals.md",
    },
    {
        "slug": "database-fundamentals",
        "position": 4,
        "title": "Database Fundamentals",
        "duration": "100–130 minutes",
        "excerpt": "ACID transactions, SQL versus NoSQL, indexes, sharding, replication, database scaling, database types, bloom filters, and active-active architectures.",
        "section": "Data Layer",
        "file": "04-database-fundamentals.md",
    },
    {
        "slug": "caching-fundamentals",
        "position": 5,
        "title": "Caching Fundamentals",
        "duration": "60–80 minutes",
        "excerpt": "What caching solves, caching strategies, eviction policies, distributed caching, and content delivery networks.",
        "section": "Data Layer",
        "file": "05-caching-fundamentals.md",
    },
    {
        "slug": "asynchronous-communication",
        "position": 6,
        "title": "Asynchronous Communication",
        "duration": "40–55 minutes",
        "excerpt": "Publish/subscribe messaging, message queues, and change data capture.",
        "section": "Distributed Systems",
        "file": "06-asynchronous-communication.md",
    },
    {
        "slug": "distributed-systems-and-microservices",
        "position": 7,
        "title": "Distributed Systems and Microservices",
        "duration": "100–130 minutes",
        "excerpt": "Heartbeats, service discovery, consensus algorithms, distributed locking, gossip protocols, the circuit breaker pattern, disaster recovery, and distributed tracing.",
        "section": "Distributed Systems",
        "file": "07-distributed-systems-and-microservices.md",
    },
    {
        "slug": "architectural-patterns",
        "position": 8,
        "title": "Architectural Patterns",
        "duration": "60–80 minutes",
        "excerpt": "Client-server, microservices, serverless, event-driven, and peer-to-peer architectures.",
        "section": "Distributed Systems",
        "file": "08-architectural-patterns.md",
    },
    {
        "slug": "system-design-tradeoffs",
        "position": 9,
        "title": "System Design Trade-offs",
        "duration": "120–150 minutes",
        "excerpt": "Twelve trade-off pairs every designer weighs: scaling direction, concurrency vs. parallelism, long polling vs. WebSockets, batch vs. stream, stateful vs. stateless, strong vs. eventual consistency, cache write strategy, push vs. pull, REST vs. RPC, sync vs. async, and latency vs. throughput.",
        "section": "Trade-offs & Synthesis",
        "file": "09-system-design-tradeoffs.md",
    },
)

LLD_BASICS_MODULE_SEEDS = (
    {"slug": "oop-fundamentals", "position": 1, "title": "OOP Fundamentals — the Four Pillars", "duration": "25–35 minutes", "excerpt": "Encapsulation, abstraction, inheritance, and polymorphism, each shown as real Java rather than definitions — the foundation every later lesson builds on.", "section": "Foundations", "file": "01-oop-fundamentals.md", "codeFile": "OopFundamentals.java"},
    {"slug": "solid-principles", "position": 2, "title": "SOLID Principles", "duration": "30–40 minutes", "excerpt": "Five concrete, checkable rules for extensible design — SRP, OCP, LSP, ISP, and DIP — each with a before/after code example.", "section": "Foundations", "file": "02-solid-principles.md", "codeFile": "SolidPrinciples.java"},
    {"slug": "uml-class-diagrams", "position": 3, "title": "UML Class Diagrams for LLD Interviews", "duration": "20–25 minutes", "excerpt": "The subset of UML that actually shows up on a whiteboard: class boxes, interfaces, and the six relationship arrows, including multiplicity.", "section": "Foundations", "file": "03-uml-class-diagrams.md"},
    {"slug": "relationships-association-aggregation-composition", "position": 4, "title": "Object Relationships: Association, Aggregation & Composition", "duration": "25–30 minutes", "excerpt": "The ownership-and-lifetime distinction interviewers probe hardest, with a decision checklist and worked examples.", "section": "Foundations", "file": "04-relationships-association-aggregation-composition.md", "codeFile": "Relationships.java"},
    {"slug": "singleton-pattern", "position": 5, "title": "Singleton Pattern", "duration": "25–30 minutes", "excerpt": "A correctly thread-safe Singleton (via the initialization-on-demand holder idiom) and an honest look at why it has a bad reputation.", "section": "Creational Patterns", "file": "05-singleton-pattern.md", "codeFile": "SingletonPattern.java"},
    {"slug": "factory-method-abstract-factory", "position": 6, "title": "Factory Method & Abstract Factory Pattern", "duration": "30–35 minutes", "excerpt": "Move object-creation decisions out of client code — first one product at a time, then as a family of mutually-consistent products.", "section": "Creational Patterns", "file": "06-factory-method-abstract-factory.md", "codeFile": "FactoryPatterns.java"},
    {"slug": "builder-pattern", "position": 7, "title": "Builder Pattern", "duration": "20–25 minutes", "excerpt": "Replace telescoping constructors with fluent, validated, immutable object construction.", "section": "Creational Patterns", "file": "07-builder-pattern.md", "codeFile": "BuilderPattern.java"},
    {"slug": "prototype-pattern", "position": 8, "title": "Prototype Pattern", "duration": "20–25 minutes", "excerpt": "Clone existing objects instead of expensive re-construction — and the shallow-vs-deep-copy trap that breaks naive clones.", "section": "Creational Patterns", "file": "08-prototype-pattern.md", "codeFile": "PrototypePattern.java"},
    {"slug": "adapter-pattern", "position": 9, "title": "Adapter Pattern", "duration": "20–25 minutes", "excerpt": "Wrap an incompatible legacy or third-party interface so it matches the one your code already expects.", "section": "Structural Patterns", "file": "09-adapter-pattern.md", "codeFile": "AdapterPattern.java"},
    {"slug": "decorator-pattern", "position": 10, "title": "Decorator Pattern", "duration": "25–30 minutes", "excerpt": "Add stackable responsibilities to an object at runtime, avoiding a combinatorial explosion of subclasses.", "section": "Structural Patterns", "file": "10-decorator-pattern.md", "codeFile": "DecoratorPattern.java"},
    {"slug": "facade-pattern", "position": 11, "title": "Facade Pattern", "duration": "20–25 minutes", "excerpt": "One simple entry point in front of a multi-class subsystem, without hiding the subsystem from callers who need it.", "section": "Structural Patterns", "file": "11-facade-pattern.md", "codeFile": "FacadePattern.java"},
    {"slug": "composite-pattern", "position": 12, "title": "Composite Pattern", "duration": "20–25 minutes", "excerpt": "Treat individual objects and trees of objects through one interface — files and folders, without instanceof branching.", "section": "Structural Patterns", "file": "12-composite-pattern.md", "codeFile": "CompositePattern.java"},
    {"slug": "proxy-pattern", "position": 13, "title": "Proxy Pattern", "duration": "25–30 minutes", "excerpt": "Control access to an object — lazy loading, permission checks — behind the same interface as the real thing, and how it differs from Decorator.", "section": "Structural Patterns", "file": "13-proxy-pattern.md", "codeFile": "ProxyPattern.java"},
    {"slug": "strategy-pattern", "position": 14, "title": "Strategy Pattern", "duration": "25–30 minutes", "excerpt": "Make an algorithm swappable at runtime — the most common fix for a growing if/else chain, and the first of six behavioral patterns.", "section": "Behavioral Patterns", "file": "14-strategy-pattern.md", "codeFile": "StrategyPattern.java"},
    {"slug": "observer-pattern", "position": 15, "title": "Observer Pattern", "duration": "25–30 minutes", "excerpt": "Let a subject notify a dynamic list of observers without knowing anything concrete about them — push vs. pull, and the unsubscribe leak to avoid.", "section": "Behavioral Patterns", "file": "15-observer-pattern.md", "codeFile": "ObserverPattern.java"},
    {"slug": "state-pattern", "position": 16, "title": "State Pattern", "duration": "25–30 minutes", "excerpt": "Replace a status-flag-plus-if/else mess with one class per state, and how to tell State apart from Strategy.", "section": "Behavioral Patterns", "file": "16-state-pattern.md", "codeFile": "StatePattern.java"},
    {"slug": "command-pattern", "position": 17, "title": "Command Pattern", "duration": "25–30 minutes", "excerpt": "Turn a request into an object so it can be queued, logged, undone, or replayed — with a working undo/redo remote-control example.", "section": "Behavioral Patterns", "file": "17-command-pattern.md", "codeFile": "CommandPattern.java"},
    {"slug": "template-method-chain-of-responsibility", "position": 18, "title": "Template Method & Chain of Responsibility", "duration": "30–35 minutes", "excerpt": "Fix an algorithm's shape while letting subclasses vary one step, then let a request travel down a line of handlers until one accepts it.", "section": "Behavioral Patterns", "file": "18-template-method-chain-of-responsibility.md", "codeFile": "TemplateMethodAndChainOfResponsibility.java"},
)

LLD_PRACTICE_MODULE_SEEDS = (
    {"slug": "how-to-approach-an-lld-interview", "position": 1, "title": "How to Approach an LLD Interview", "duration": "20–25 minutes", "excerpt": "A repeatable five-stage framework — requirements, objects, relationships, patterns, trade-offs — applied to every problem in this course.", "section": "Getting Started", "file": "01-how-to-approach-an-lld-interview.md"},
    {"slug": "design-a-parking-lot", "position": 2, "title": "Design a Parking Lot", "duration": "40–50 minutes", "excerpt": "The most commonly asked LLD problem: multi-level lot, size-matched spot allocation, thread-safe occupancy, and a pluggable fee strategy.", "section": "Machines & Devices", "file": "02-design-a-parking-lot.md", "codeFile": "ParkingLotSystem.java"},
    {"slug": "design-an-elevator-system", "position": 3, "title": "Design an Elevator System", "duration": "40–50 minutes", "excerpt": "Multi-elevator scheduling: a controller-side selection strategy plus per-elevator SCAN-style stop ordering.", "section": "Machines & Devices", "file": "03-design-an-elevator-system.md", "codeFile": "ElevatorSystem.java"},
    {"slug": "design-a-vending-machine", "position": 4, "title": "Design a Vending Machine", "duration": "30–40 minutes", "excerpt": "A textbook State-pattern application: Idle, HasMoney, and Dispensing states each defining their own legal actions.", "section": "Machines & Devices", "file": "04-design-a-vending-machine.md", "codeFile": "VendingMachineSystem.java"},
    {"slug": "design-a-traffic-light-system", "position": 5, "title": "Design a Traffic Light System", "duration": "25–35 minutes", "excerpt": "A focused State-pattern warm-up: self-scheduling light states and conflict-free intersection phases.", "section": "Machines & Devices", "file": "05-design-a-traffic-light-system.md", "codeFile": "TrafficLightSystem.java"},
    {"slug": "design-an-atm", "position": 6, "title": "Design an ATM", "duration": "35–45 minutes", "excerpt": "State-driven transaction lifecycle plus a real algorithmic sub-problem: dispensing the correct bill breakdown for an amount.", "section": "Machines & Devices", "file": "06-design-an-atm.md", "codeFile": "AtmSystem.java"},
    {"slug": "design-a-library-management-system", "position": 7, "title": "Design a Library Management System", "duration": "35–45 minutes", "excerpt": "A broader multi-entity system: Book vs. BookCopy multiplicity, Checkout as a first-class entity, and a pluggable fine calculator.", "section": "Information Systems", "file": "07-design-a-library-management-system.md", "codeFile": "LibrarySystem.java"},
    {"slug": "design-a-tic-tac-toe-game", "position": 8, "title": "Design a Tic-Tac-Toe Game", "duration": "30–35 minutes", "excerpt": "A generalized N x N board with O(1) incremental win detection instead of rescanning the board on every move.", "section": "Games & Simulations", "file": "08-design-a-tic-tac-toe-game.md", "codeFile": "TicTacToeGame.java"},
    {"slug": "design-a-chess-game", "position": 9, "title": "Design a Chess Game", "duration": "45–60 minutes", "excerpt": "The deepest LLD interview problem: polymorphic per-piece move generation, possible-vs-legal moves, and check detection.", "section": "Games & Simulations", "file": "09-design-a-chess-game.md", "codeFile": "ChessGame.java"},
    {"slug": "design-a-snake-and-ladder-game", "position": 10, "title": "Design a Snake and Ladder Game", "duration": "25–30 minutes", "excerpt": "Modeling snakes and ladders as one unified Jump concept, plus the no-overshoot rule.", "section": "Games & Simulations", "file": "10-design-a-snake-and-ladder-game.md", "codeFile": "SnakeAndLadderGame.java"},
    {"slug": "design-an-lru-cache", "position": 11, "title": "Design an LRU Cache", "duration": "30–40 minutes", "excerpt": "Hitting O(1) get and put by combining a hash map with a doubly-linked list, using sentinel head/tail nodes.", "section": "Data Structures & Infrastructure", "file": "11-design-an-lru-cache.md", "codeFile": "LruCacheSystem.java"},
    {"slug": "design-a-rate-limiter", "position": 12, "title": "Design a Rate Limiter", "duration": "35–40 minutes", "excerpt": "Fixed window vs. sliding window log vs. token bucket, and why token bucket is the industry-standard choice.", "section": "Data Structures & Infrastructure", "file": "12-design-a-rate-limiter.md", "codeFile": "RateLimiterSystem.java"},
    {"slug": "design-a-logging-framework", "position": 13, "title": "Design a Logging Framework", "duration": "25–35 minutes", "excerpt": "A compact review problem touching Singleton, fan-out appenders, and Strategy-based formatting all at once.", "section": "Data Structures & Infrastructure", "file": "13-design-a-logging-framework.md", "codeFile": "LoggingFramework.java"},
    {"slug": "design-a-notification-alerting-system", "position": 14, "title": "Design a Notification/Alerting System", "duration": "30–35 minutes", "excerpt": "Observer at a larger scale: per-user channel fan-out with isolated per-channel delivery failures.", "section": "Larger Systems & Marketplaces", "file": "14-design-a-notification-alerting-system.md", "codeFile": "NotificationSystem.java"},
    {"slug": "design-a-movie-ticket-booking-system", "position": 15, "title": "Design a Movie Ticket Booking System", "duration": "40–50 minutes", "excerpt": "The core interview concurrency problem: per-seat holds with expiry, and a Facade sequencing hold, payment, and confirm.", "section": "Larger Systems & Marketplaces", "file": "15-design-a-movie-ticket-booking-system.md", "codeFile": "MovieTicketBookingSystem.java"},
    {"slug": "design-a-splitwise-style-expense-sharing-system", "position": 16, "title": "Design a Splitwise-style Expense Sharing System", "duration": "40–50 minutes", "excerpt": "Pluggable split strategies, exact-cent remainder handling, and a greedy algorithm that minimizes settlement transactions.", "section": "Larger Systems & Marketplaces", "file": "16-design-a-splitwise-style-expense-sharing-system.md", "codeFile": "ExpenseSharingSystem.java"},
    {"slug": "design-a-hotel-car-rental-booking-system", "position": 17, "title": "Design a Hotel/Car Rental Booking System", "duration": "35–45 minutes", "excerpt": "Availability modeled as interval overlap, an atomic per-unit locked reserve operation, and correct back-to-back-booking handling.", "section": "Larger Systems & Marketplaces", "file": "17-design-a-hotel-car-rental-booking-system.md", "codeFile": "BookingSystem.java"},
    {"slug": "design-a-task-scheduler", "position": 18, "title": "Design a Task Scheduler", "duration": "35–45 minutes", "excerpt": "Command-based tasks, a single priority-plus-time ordering, flag-based cancellation, and a non-busy-waiting worker pool.", "section": "Larger Systems & Marketplaces", "file": "18-design-a-task-scheduler.md", "codeFile": "TaskSchedulerSystem.java"},
)

COURSE_SEEDS = (
    {
        "id": "linux-homelab-foundations",
        "title": "Linux Homelab Foundations — The Clear Guide",
        "subtitle": "Learn Linux as the operator of hp-codex, ubuntu-purva, pi-purva, and the services between them.",
        "description": "A slow, visual, hands-on foundation covering how Linux works, shell reasoning, the directory tree, users, groups, permissions, Docker, and NFS identity.",
        "level": "Foundation",
        "estimatedHours": "23–30 hours",
        "source": "Linux-Homelab-Foundations-Clear-Guide.pdf",
        "modules": LINUX_MODULE_SEEDS,
    },
    {
        "id": "toolhub-codex-integration-architecture",
        "title": "ToolHub–Codex Integration Architecture",
        "subtitle": "A complete HLD and LLD review of ToolHub's reusable private AI platform.",
        "description": "Understand every layer from the ToolHub course and chat interfaces through MongoDB, the signed provider-neutral gateway, the private hp-codex executor, and the Codex CLI runtime — then see the platform reused end-to-end by a second application, LeetCode AI.",
        "level": "Intermediate",
        "estimatedHours": "9–11 hours",
        "source": "Verified production implementation and deployment documentation",
        "modules": INTEGRATION_MODULE_SEEDS,
    },
    {
        "id": "system-design-interview-playbook",
        "title": "System Design Interview Playbook",
        "subtitle": "A beginner-friendly, modular walk through the classic HLD interview problems.",
        "description": "Start with a repeatable seven-stage framework for answering any 'design X' question, then apply it to 45 classic system design interview problems grouped Easy, Medium and Hard — from a URL shortener to a distributed locking service — each with requirements, scale estimation, an API and data model, a high-level architecture, a deep dive into the genuinely hard part, and an honest look at bottlenecks and trade-offs.",
        "level": "Beginner",
        "estimatedHours": "60–75 hours",
        "source": "Original lessons written for this course, structured around the problem list curated in ashishps1/awesome-system-design-resources.",
        "modules": HLD_INTERVIEW_MODULE_SEEDS,
    },
    {
        "id": "hld-fundamentals",
        "title": "HLD Fundamentals",
        "subtitle": "The building blocks behind every high-level design, explained from first principles.",
        "description": "Nine modules covering the concepts every later system-design lesson assumes you already know: core reliability/scalability vocabulary, networking, APIs, databases, caching, asynchronous communication, distributed systems and microservices, architectural patterns, and the trade-offs that tie them all together. Meant to be read before, or alongside, the System Design Interview Playbook.",
        "level": "Foundation",
        "estimatedHours": "14–18 hours",
        "source": "Original lessons written for this course, structured around the fundamentals list curated in ashishps1/awesome-system-design-resources.",
        "modules": HLD_FUNDAMENTALS_MODULE_SEEDS,
    },
    {
        "id": "lld-basics",
        "title": "LLD Basics: OOP to Design Patterns",
        "subtitle": "The object-oriented toolkit every low-level design answer draws on.",
        "description": "Eighteen modules covering the four pillars of OOP, the five SOLID principles, UML notation, object relationships, and sixteen Gang-of-Four design patterns across creational, structural, and behavioral categories — each with a runnable, downloadable Java example.",
        "level": "Foundation",
        "estimatedHours": "8–10 hours",
        "source": "Original lessons and Java implementations written for this course.",
        "modules": LLD_BASICS_MODULE_SEEDS,
    },
    {
        "id": "lld-interview-practice",
        "title": "LLD Practice: Interview Problems",
        "subtitle": "A five-stage framework applied to 17 classic low-level design interview problems.",
        "description": "Start with a repeatable framework for answering any 'design X' LLD question, then apply it to 17 classic problems — from a parking lot to a task scheduler — each with requirements, class design, key trade-offs, and a complete, downloadable Java reference implementation.",
        "level": "Intermediate",
        "estimatedHours": "9–11 hours",
        "source": "Original lessons and Java implementations written for this course.",
        "modules": LLD_PRACTICE_MODULE_SEEDS,
    },
)


def _module_id(course_id: str, slug: str) -> str:
    return f"{course_id}:{slug}"


def _relevant_module_context(content: str, question: str, budget: int) -> str:
    """Return an outline plus question-relevant lesson blocks within the gateway limit."""
    if budget <= 0:
        return ""
    blocks = [block.strip() for block in re.split(r"\n\s*\n", content) if block.strip()]
    terms = {
        term for term in re.findall(r"[a-z0-9_-]{3,}", question.lower())
        if term not in CONTEXT_STOP_WORDS
    }
    headings = [block for block in blocks if block.startswith("#")]
    ranked = sorted(
        enumerate(blocks),
        key=lambda item: (
            sum(item[1].lower().count(term) for term in terms),
            1 if item[1].startswith("#") else 0,
            -item[0],
        ),
        reverse=True,
    )
    candidates = ["Module outline:\n" + "\n".join(headings)]
    candidates.extend(block for _, block in ranked)
    chosen: list[str] = []
    used: set[str] = set()
    remaining = budget
    for candidate in candidates:
        if candidate in used or remaining <= 0:
            continue
        used.add(candidate)
        piece = candidate[:remaining]
        if piece:
            chosen.append(piece)
            remaining -= len(piece) + 2
    return "\n\n".join(chosen)[:budget]


def _public_module(document: Dict[str, Any], include_content: bool = False) -> Dict[str, Any]:
    result = {
        "id": document["id"],
        "courseId": document["courseId"],
        "slug": document["slug"],
        "position": document["position"],
        "title": document["title"],
        "duration": document["duration"],
        "excerpt": document["excerpt"],
        "section": document.get("section", ""),
        "readingMinutes": document.get("readingMinutes", 1),
        "updatedAt": document["updatedAt"],
    }
    if include_content:
        result["content"] = document["content"]
        if document.get("javaCode"):
            result["javaCode"] = document["javaCode"]
            result["javaFileName"] = document.get("javaFileName")
    return jsonable(result)


def _public_question(document: Dict[str, Any]) -> Dict[str, Any]:
    return jsonable({
        "id": document["id"],
        "courseId": document["courseId"],
        "moduleId": document["moduleId"],
        "moduleSlug": document["moduleSlug"],
        "selectedText": document["selectedText"],
        "question": document["question"],
        "answer": document.get("answer", ""),
        "status": document.get("status", "pending"),
        "error": document.get("error", ""),
        "createdAt": document["createdAt"],
        "updatedAt": document["updatedAt"],
    })


def ensure_course_indexes_and_seed() -> None:
    courses = col(COURSES)
    modules = col(MODULES)
    questions = col(QUESTIONS)
    progress = col(PROGRESS)
    courses.create_index([("id", ASCENDING)], unique=True)
    modules.create_index([("id", ASCENDING)], unique=True)
    modules.create_index([("courseId", ASCENDING), ("position", ASCENDING)], unique=True)
    questions.create_index([("id", ASCENDING)], unique=True)
    questions.create_index([("ownerId", ASCENDING), ("moduleId", ASCENDING), ("createdAt", DESCENDING)])
    progress.create_index([("ownerId", ASCENDING), ("moduleId", ASCENDING)], unique=True)

    now = now_iso()
    for course_seed in COURSE_SEEDS:
        course_id = course_seed["id"]
        seeded = []
        for item in course_seed["modules"]:
            path = SEED_ROOT / course_id / item["file"]
            if not path.is_file():
                raise RuntimeError(f"Course seed is missing: {course_id}/{item['file']}")
            content = path.read_text(encoding="utf-8").strip()
            content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
            module = {
                "id": _module_id(course_id, item["slug"]),
                "courseId": course_id,
                "slug": item["slug"],
                "position": item["position"],
                "title": item["title"],
                "duration": item["duration"],
                "excerpt": item["excerpt"],
                "section": item.get("section", ""),
                "content": content,
                "contentHash": content_hash,
                "readingMinutes": max(1, (len(content.split()) + 219) // 220),
                "updatedAt": now,
            }
            code_file = item.get("codeFile")
            if code_file:
                code_path = SEED_ROOT / course_id / code_file
                if not code_path.is_file():
                    raise RuntimeError(f"Course seed is missing: {course_id}/{code_file}")
                module["javaCode"] = code_path.read_text(encoding="utf-8").strip()
                module["javaFileName"] = code_file.rsplit("/", 1)[-1]
            modules.update_one(
                {"id": module["id"]},
                {"$set": module, "$setOnInsert": {"createdAt": now}},
                upsert=True,
            )
            seeded.append(module)

        courses.update_one(
            {"id": course_id},
            {
                "$set": {
                    "id": course_id,
                    "title": course_seed["title"],
                    "subtitle": course_seed["subtitle"],
                    "description": course_seed["description"],
                    "level": course_seed["level"],
                    "estimatedHours": course_seed["estimatedHours"],
                    "moduleCount": len(seeded),
                    "status": "published",
                    "source": course_seed["source"],
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": now},
            },
            upsert=True,
        )


def _course(course_id: str) -> Dict[str, Any]:
    document = col(COURSES).find_one({"id": course_id, "status": "published"})
    if not document:
        raise HTTPException(status_code=404, detail="Course not found")
    return document


def _module(course_id: str, module_slug: str) -> Dict[str, Any]:
    if not SLUG_PATTERN.fullmatch(module_slug):
        raise HTTPException(status_code=404, detail="Course module not found")
    document = col(MODULES).find_one({"courseId": course_id, "slug": module_slug})
    if not document:
        raise HTTPException(status_code=404, detail="Course module not found")
    return document


def list_courses(owner_id: str) -> list[Dict[str, Any]]:
    result = []
    for course in col(COURSES).find({"status": "published"}).sort("createdAt", ASCENDING):
        completed = col(PROGRESS).count_documents({
            "ownerId": owner_id,
            "courseId": course["id"],
            "completed": True,
        })
        item = jsonable(course)
        item.pop("_id", None)
        item["completedModuleCount"] = completed
        result.append(item)
    return result


def get_course(course_id: str, owner_id: str) -> Dict[str, Any]:
    course = jsonable(_course(course_id))
    course.pop("_id", None)
    progress_by_module = {
        item["moduleId"]: item
        for item in col(PROGRESS).find({"ownerId": owner_id, "courseId": course_id})
    }
    modules = []
    for module in col(MODULES).find({"courseId": course_id}).sort("position", ASCENDING):
        item = _public_module(module)
        progress = progress_by_module.get(module["id"], {})
        item["completed"] = bool(progress.get("completed"))
        item["readingProgress"] = float(progress.get("readingProgress") or 0)
        modules.append(item)
    course["modules"] = modules
    course["completedModuleCount"] = sum(1 for module in modules if module["completed"])
    return course


def get_course_module(course_id: str, module_slug: str, owner_id: str) -> Dict[str, Any]:
    _course(course_id)
    module = _module(course_id, module_slug)
    progress = col(PROGRESS).find_one({"ownerId": owner_id, "moduleId": module["id"]}) or {}
    result = _public_module(module, include_content=True)
    result["completed"] = bool(progress.get("completed"))
    result["readingProgress"] = float(progress.get("readingProgress") or 0)
    result["questions"] = [
        _public_question(item)
        for item in col(QUESTIONS).find({"ownerId": owner_id, "moduleId": module["id"]}).sort("createdAt", DESCENDING)
    ]
    return result


def update_progress(course_id: str, module_slug: str, owner_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    _course(course_id)
    module = _module(course_id, module_slug)
    try:
        reading_progress = float(body.get("readingProgress", 0))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid reading progress") from exc
    reading_progress = max(0.0, min(1.0, reading_progress))
    completed = bool(body.get("completed"))
    now = now_iso()
    col(PROGRESS).update_one(
        {"ownerId": owner_id, "moduleId": module["id"]},
        {
            "$set": {
                "ownerId": owner_id,
                "courseId": course_id,
                "moduleId": module["id"],
                "moduleSlug": module_slug,
                "readingProgress": 1.0 if completed else reading_progress,
                "completed": completed,
                "updatedAt": now,
            },
            "$setOnInsert": {"createdAt": now},
        },
        upsert=True,
    )
    return {"moduleId": module["id"], "readingProgress": 1.0 if completed else reading_progress, "completed": completed}


def create_course_question(course_id: str, module_slug: str, owner_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    course = _course(course_id)
    module = _module(course_id, module_slug)
    selected_text = str(body.get("selectedText") or "").strip()
    question = str(body.get("question") or "").strip()
    context_before = str(body.get("contextBefore") or "").strip()
    context_after = str(body.get("contextAfter") or "").strip()
    if len(selected_text) > MAX_SELECTION:
        raise HTTPException(status_code=400, detail="Selected text cannot exceed 4000 characters")
    if not question or len(question) > MAX_QUESTION:
        raise HTTPException(status_code=400, detail="Question must contain 1 to 2000 characters")
    if len(context_before) + len(context_after) > MAX_SURROUNDING_CONTEXT:
        raise HTTPException(status_code=400, detail="Selection context is too large")
    now = now_iso()
    document = {
        "id": str(uuid.uuid4()),
        "ownerId": owner_id,
        "courseId": course_id,
        "courseTitle": course["title"],
        "moduleId": module["id"],
        "moduleSlug": module_slug,
        "moduleTitle": module["title"],
        "moduleContentSnapshot": module["content"],
        "moduleContentHash": module.get("contentHash", ""),
        "selectedText": selected_text,
        "question": question,
        "contextBefore": context_before,
        "contextAfter": context_after,
        "answer": "",
        "status": "pending",
        "error": "",
        "createdAt": now,
        "updatedAt": now,
    }
    col(QUESTIONS).insert_one(document)
    return _public_question(document)


def complete_course_question_safely(question_id: str) -> None:
    document = col(QUESTIONS).find_one({"id": question_id, "status": "pending"})
    if not document:
        return
    try:
        selected = str(document.get("selectedText") or "")[:3500]
        surrounding = "\n\n".join(
            part for part in (document.get("contextBefore", ""), document.get("contextAfter", "")) if part
        )[:1800]
        module_budget = AI_CONTEXT_BUDGET - len(selected) - len(surrounding)
        module_context = _relevant_module_context(
            str(document.get("moduleContentSnapshot") or ""),
            document["question"],
            max(1200, module_budget),
        )
        context = [
            {"type": "text", "label": "Course", "text": document["courseTitle"]},
            {"type": "text", "label": "Module", "text": document["moduleTitle"]},
            {
                "type": "text",
                "label": "Relevant module lesson context",
                "text": module_context,
            },
        ]
        if selected:
            context.append({"type": "text", "label": "Selected passage", "text": selected})
        if surrounding:
            context.append({"type": "text", "label": "Surrounding lesson context", "text": surrounding})
        provider, response = routed_gateway_request(
            "POST",
            "/v1/responses",
            payload={
                "input": (
                    "Use the supplied course module as the primary context. "
                    + ("Give special attention to the selected passage. " if document.get("selectedText") else "")
                    + "Answer this learner question in direct, beginner-friendly language: "
                    + document["question"]
                ),
                "conversation": {"providerConversationId": None},
                "context": context,
                "capabilityProfile": "knowledge-only",
                "metadata": {
                    "application": "toolhub-courses",
                    "courseId": document["courseId"],
                    "moduleId": document["moduleId"],
                    "questionId": question_id,
                },
            },
            timeout=330,
        )
        answer = str(response.get("outputText") or "").strip()
        if not answer:
            raise RuntimeError("AI gateway returned an empty course explanation")
        col(QUESTIONS).update_one(
            {"id": question_id},
            {"$set": {
                "answer": answer,
                "status": "completed",
                "error": "",
                "provider": provider,
                "providerRequestId": str(response.get("id") or ""),
                "providerConversationId": str((response.get("conversation") or {}).get("providerConversationId") or ""),
                "updatedAt": now_iso(),
            }},
        )
    except Exception as exc:
        logger.exception("Course explanation failed for question %s", question_id)
        col(QUESTIONS).update_one(
            {"id": question_id},
            {"$set": {
                "status": "failed",
                "error": "The AI explanation could not be completed. Try again.",
                "updatedAt": now_iso(),
            }},
        )


def get_course_question(question_id: str, owner_id: str) -> Dict[str, Any]:
    document = col(QUESTIONS).find_one({"id": question_id, "ownerId": owner_id})
    if not document:
        raise HTTPException(status_code=404, detail="Course question not found")
    return _public_question(document)
