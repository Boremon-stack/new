# Multi-Authority Identity Security Layer (MAIS)

> **Security through Geographic Distribution & Quantum Uncertainty**

## Overview
Multi-Authority Identity Security Layer (MAIS) is a high-security storage system designed for high-value individuals. It leverages true randomness from quantum vacuum fluctuations and geographic sharding to securing secrets.

## Core Architecture: The "Quantum Tree"
1.  **Level 1: District Nodes (Leaves)**: Local storage points (devices, trusted contacts).
2.  **Level 2: State Nodes (Branches)**: Aggregators/Validators.
3.  **Level 3: Cardinal Direction Nodes (Roots)**: The final 4 guardians (N, S, E, W). 3 of 4 required to unlock.

## Features
- **Quantum Probability Collapse**: Uses ANU Quantum Random Numbers API for true entropy.
- **Geo-Sharding**: Shamir's Secret Sharing (SSS) for distributing keys across locations.
- **Tree Reset**: Recovery mechanism requiring physical cooperation of distributed nodes.

## Technologies
- **Backend**: Python (Core Logic, API Integrations)
- **Frontend**: HTML/CSS/JS (Compass Dashboard)
- **Blockchain**: Ethereum (Smart Contracts for State/Cardinal nodes)

## Setup

### Prerequisites
- Python 3.8+
- Node.js (optional, for advanced frontend dev)
- Ethereum connection (e.g., Infura, Alchemy, or local Ganache)

### Installation
1.  Clone the repository:
    ```bash
    git clone <repo-url>
    cd vault-quantum-geo
    ```
2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```

### Usage
1.  **Generate Quantum Seed**:
    ```bash
    python backend/core/quantum_seed.py
    ```
2.  **Run Sharding Logic**:
    ```bash
    python backend/core/geo_sharding.py
    ```
3.  **Launch Dashboard**:
    Open `frontend/index.html` in your browser.

## Reference
- **ANU Quantum Random Numbers API**: https://quantumnumbers.anu.edu.au/
- **UIDAI – Aadhaar & CIDR identity architecture
- **DigiLocker – Centralized document storage model
- **Australian National University – Quantum Random Number Generator (ANU QRNG API)
- **Threshold Cryptography – Multi-party key control (M-of-N)

## License
MIT
