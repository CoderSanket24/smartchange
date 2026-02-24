from fastapi import FastAPI

app = FastAPI(title="SmartChange API")

@app.get("/")
def home():
    return {"message": "SmartChange Backend Running 🚀"}