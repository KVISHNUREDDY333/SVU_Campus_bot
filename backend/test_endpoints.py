import requests
import sys

BASE_URL = "http://127.0.0.1:8000"

def test_endpoints():
    print(f"Testing endpoints on {BASE_URL}...")
    
    # Test Admin Test (GET) - NEW
    try:
        res = requests.get(f"{BASE_URL}/admin/test")
        print(f"/admin/test: {res.status_code}")
    except Exception as e:
        print(f"/admin/test: Failed - {e}")

    # Test Admin Trending (GET)
    try:
        res = requests.get(f"{BASE_URL}/admin/trending")
        print(f"/admin/trending (GET): {res.status_code}")
    except Exception as e:
        print(f"/admin/trending (GET): Failed - {e}")

if __name__ == "__main__":
    test_endpoints()
