from secretsharing import SecretSharer
from typing import List, Dict

class GeoSharding:
    """
    Implements the 'Quantum Tree' hierarchical secret sharing.
    Level 1: Root Secret -> 4 Cardinal Nodes (North, South, East, West). Threshold: 3.
    Level 2: Cardinal Share -> 5 State Nodes. Threshold: 3.
    Level 3: State Share -> District Nodes.
    """

    @staticmethod
    def split_secret(secret: str) -> Dict[str, str]:
        """
        Splits the master secret into 4 Cardinal shares (N, S, E, W).
        Requires 3 to reconstruct.
        """
        # secretsharing library usually returns shares as "1-hexcode", "2-hexcode", etc.
        # We need 4 shares, threshold 3.
        shares = SecretSharer.split_secret(secret, 3, 4)
        
        # Map to Cardinal directions for conceptual clarity
        cardinal_map = {
            "North": shares[0],
            "South": shares[1],
            "East": shares[2],
            "West": shares[3]
        }
        return cardinal_map

    @staticmethod
    def split_cardinal_share(cardinal_share: str, num_states: int = 5, threshold: int = 3) -> List[str]:
        """
        Splits a Cardinal share (e.g., North) into 'State' shares.
        """
        shares = SecretSharer.split_secret(cardinal_share, threshold, num_states)
        return shares

    @staticmethod
    def split_state_share(state_share: str, num_districts: int = 5, threshold: int = 3) -> List[str]:
        """
        Splits a State share into 'District' shares.
        """
        shares = SecretSharer.split_secret(state_share, threshold, num_districts)
        return shares

    @staticmethod
    def recover_secret(shares: List[str]) -> str:
        """
        Recovers a secret from a list of valid shares.
        """
        try:
            return SecretSharer.recover_secret(shares)
        except Exception as e:
            raise ValueError(f"Failed to recover secret: {str(e)}")

# Example usage
if __name__ == "__main__":
    # Test Data
    master_secret = "c4bbcb1fbec99d65bf59d85c8cb62ee2db963f0fe106f483d9afa73bd4e39a8a"
    print(f"Original Secret: {master_secret}")

    # 1. Root Split (Cardinal)
    print("\n--- Level 1: Cardinal Split (Threshold 3/4) ---")
    cardinal_shares = GeoSharding.split_secret(master_secret)
    for direction, share in cardinal_shares.items():
        print(f"{direction}: {share[:20]}...")

    # 2. State Split (North Branch)
    print("\n--- Level 2: North State Split (Threshold 3/5) ---")
    north_share = cardinal_shares["North"]
    state_shares = GeoSharding.split_cardinal_share(north_share)
    for i, share in enumerate(state_shares):
        print(f"State Node {i+1}: {share[:20]}...")

    # 3. Reconstruction Test
    print("\n--- Reconstruction Test ---")
    # Let's say we have South, East, and West (North is missing)
    available_shares = [
        cardinal_shares["South"],
        cardinal_shares["East"],
        cardinal_shares["West"]
    ]
    recovered = GeoSharding.recover_secret(available_shares)
    print(f"Recovered Secret: {recovered}")
    
    if recovered == master_secret:
        print("SUCCESS: Secret successfully reconstructed from subset of shares.")
    else:
        print("FAILURE: Reconstruction mismatch.")
