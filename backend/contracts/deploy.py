from web3 import Web3
from solcx import compile_source, install_solc
import json
import os

# --- Configuration ---
# For demo purposes, we use a mock provider (eth-tester) or local Ganache
# In production, use os.getenv("INFURA_URL")
USE_MOCK = True

def deploy_contract():
    print("--- 1. Initializing Web3 Provider ---")
    if USE_MOCK:
        from eth_tester import EthereumTester
        from web3.providers.eth_tester import EthereumTesterProvider
        w3 = Web3(EthereumTesterProvider())
        print("Using EthereumTester (Mock Network)")
    else:
        w3 = Web3(Web3.HTTPProvider('http://127.0.0.1:8545'))
        print("Using Local Node")

    w3.eth.default_account = w3.eth.accounts[0]
    print(f"Deployer Account: {w3.eth.default_account}")

    # --- 2. Compile Solidity Contract ---
    print("\n--- 2. Compiling Smart Contract ---")
    contract_path = os.path.join(os.path.dirname(__file__), 'QuantumVault.sol')
    with open(contract_path, 'r') as file:
        contract_source = file.read()

    # Install specific solc version if needed
    try:
        install_solc('0.8.0')
    except Exception:
        pass # Already installed or simulated environment

    compiled_sol = compile_source(
        contract_source,
        output_values=['abi', 'bin'],
        solc_version='0.8.0'
    )
    
    contract_id, contract_interface = list(compiled_sol.items())[0]
    abi = contract_interface['abi']
    bytecode = contract_interface['bin']
    
    print("Compilation Successful.")

    # --- 3. Deploy Contract ---
    print("\n--- 3. Deploying Contract ---")
    QuantumVault = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx_hash = QuantumVault.constructor().transact()
    tx_receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    
    contract_address = tx_receipt.contractAddress
    print(f"Contract Deployed At: {contract_address}")
    
    # --- 4. Interact with Contract (Simulation) ---
    print("\n--- 4. Simulating Vault Operations ---")
    vault = w3.eth.contract(address=contract_address, abi=abi)
    
    # Register Cardinals
    north_acc = w3.eth.accounts[1]
    south_acc = w3.eth.accounts[2]
    east_acc = w3.eth.accounts[3]
    west_acc = w3.eth.accounts[4]
    
    print(f"Registering North Guardian: {north_acc}")
    vault.functions.registerCardinal("North", north_acc, b'\x00'*32).transact()
    
    print(f"Registering South Guardian: {south_acc}")
    vault.functions.registerCardinal("South", south_acc, b'\x00'*32).transact()
    
    print(f"Registering East Guardian: {east_acc}")
    vault.functions.registerCardinal("East", east_acc, b'\x00'*32).transact()
    
    print("Simulating 'North' Unlock...")
    vault.functions.unlockCardinal("North").transact({'from': north_acc})
    
    print("Simulating 'South' Unlock...")
    vault.functions.unlockCardinal("South").transact({'from': south_acc})
    
    print("Simulating 'East' Unlock...")
    vault.functions.unlockCardinal("East").transact({'from': east_acc})
    
    # Check status
    is_open = vault.functions.unlockedCount().call()
    print(f"Unlocked Count: {is_open}/4")
    
    if is_open >= 3:
        print("SUCCESS: Vault Convergence Achieved!")

if __name__ == "__main__":
    try:
        deploy_contract()
    except Exception as e:
        print(f"Deployment Failed: {e}")
        print("Note: Ensure 'py-solc-x' and 'eth-tester' are installed for this script.")
