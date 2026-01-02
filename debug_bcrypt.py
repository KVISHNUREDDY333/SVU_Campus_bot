import bcrypt
password = b"testpass"
hashed = bcrypt.hashpw(password, bcrypt.gensalt())
print(f"Hash: {hashed}")
check = bcrypt.checkpw(password, hashed)
print(f"Check: {check}")
