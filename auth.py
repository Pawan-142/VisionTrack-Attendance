import hashlib
import os
import warnings
import jwt
from datetime import datetime, timedelta, timezone

# ── #1 Fix: Load secret from environment variable ─────────────────────────────
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "super-secret-visiontrack-key-change-in-production")
if SECRET_KEY == "super-secret-visiontrack-key-change-in-production":
    warnings.warn(
        "[Security] Using the default JWT_SECRET_KEY. "
        "Set the JWT_SECRET_KEY environment variable before deploying to production!",
        UserWarning,
        stacklevel=1,
    )

ALGORITHM = "HS256"
# #18 Note: Access tokens expire in 24 h with no refresh-token flow.
# For production, implement short-lived access tokens + refresh tokens,
# and add a token revocation (deny-list) mechanism.
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 1 day

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        salt_hex, key_hex = hashed_password.split('$')
        salt = bytes.fromhex(salt_hex)
        key = hashlib.pbkdf2_hmac('sha256', plain_password.encode('utf-8'), salt, 100000)
        return key.hex() == key_hex
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = os.urandom(32)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return f"{salt.hex()}${key.hex()}"

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)  # #17 Fix: timezone-aware
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt
