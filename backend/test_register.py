import requests
import json
import random

# Generate random email to avoid collision
email = f"testuser_{random.randint(1000, 9999)}@example.com"
password = "TestPassword123!" * 10  # Very long password (140+ chars)

url = "http://localhost:8000/register"
payload = {
    "email": email,
    "full_name": "Test User",
    "password": password,
    "role": "student"
}

print(f"Sending registration request for {email} ...")
try:
    response = requests.post(url, json=payload)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
    
    if response.status_code == 200:
        print("SUCCESS: Registration worked with long password!")
    else:
        print("FAILURE: Registration failed.")
except Exception as e:
    print(f"Error: {e}")
