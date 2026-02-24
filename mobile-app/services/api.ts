import axios from "axios";

export const API = axios.create({
  baseURL: "http://172.168.0.207:8000", // <-- replace with your IP
});