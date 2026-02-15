// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title QuantumVault
 * @dev Manages the "Hierarchy of Trust" for the Quantum-Geo Vault.
 *      Level 3: Cardinal Direction Nodes (Roots) - N, S, E, W
 *      Level 2: State Nodes (Branches)
 */
contract QuantumVault {
    // --- Events ---
    event CardinalNodeRegistered(string direction, address indexed nodeAddress);
    event StateNodeRegistered(string direction, address indexed nodeAddress);
    event UnlockingInitiated(address indexed initiator);
    event CardinalUnlocked(string direction);
    event VaultCollapsed(string recoveredSecretHash); // In real world, do NOT emit secret!

    // --- State Variables ---
    address public owner;
    
    // Mapping of direction (N, S, E, W) to their status/address
    struct CardinalNode {
        address nodeAddress;
        bool isUnlocked;
        bytes32 partialKeyHash; // Hash of the shard stored off-chain
    }
    
    mapping(string => CardinalNode) public cardinals;
    string[] public directions = ["North", "South", "East", "West"];
    
    uint8 public constant UNLOCK_THRESHOLD = 3;
    uint8 public unlockedCount = 0;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyCardinal(string memory _dir) {
        require(msg.sender == cardinals[_dir].nodeAddress, "Not authorized cardinal");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @dev Register a Cardinal Node (N, S, E, W).
     * @param _direction "North", "South", "East", "West"
     * @param _nodeAddress Ethereum address of the guardian
     * @param _shardHash Hash of the secret shard they hold
     */
    function registerCardinal(string memory _direction, address _nodeAddress, bytes32 _shardHash) public onlyOwner {
        cardinals[_direction] = CardinalNode({
            nodeAddress: _nodeAddress,
            isUnlocked: false,
            partialKeyHash: _shardHash
        });
        emit CardinalNodeRegistered(_direction, _nodeAddress);
    }

    /**
     * @dev Called by a Cardinal Node to "turn their key". 
     *      This happens when State/District validation is complete off-chain.
     */
    function unlockCardinal(string memory _direction) public onlyCardinal(_direction) {
        require(!cardinals[_direction].isUnlocked, "Already unlocked");
        
        cardinals[_direction].isUnlocked = true;
        unlockedCount++;
        
        emit CardinalUnlocked(_direction);
        
        if (unlockedCount >= UNLOCK_THRESHOLD) {
            _convergeVault();
        }
    }

    /**
     * @dev Internal function to finalize the unlock.
     *      In a real ZK system, this would verify a proof.
     */
    function _convergeVault() internal {
        // Logic to allow secret reconstruction
        // For demo: emit an event saying "Ready for Reconstruction"
        emit VaultCollapsed("VAULT_OPEN_READY_FOR_RECONSTRUCTION");
    }

    /**
     * @dev Reset the vault locking mechanism (re-lock).
     */
    function resetVault() public onlyOwner {
        for (uint i = 0; i < directions.length; i++) {
            cardinals[directions[i]].isUnlocked = false;
        }
        unlockedCount = 0;
    }
    
    /**
     * @dev Check status of a direction
     */
    function getCardinalStatus(string memory _direction) public view returns (bool) {
        return cardinals[_direction].isUnlocked;
    }
}
