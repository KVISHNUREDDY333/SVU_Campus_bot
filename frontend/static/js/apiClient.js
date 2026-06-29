/**
 * apiClient.js
 * Standardized API fetch wrapper for SVU Campus Bot.
 * Handles authentication tokens, error mapping, and JSON parsing globally.
 */

const API_URL = window.location.origin;

class ApiClient {
    static getHeaders(customHeaders = {}) {
        const token = sessionStorage.getItem("access_token");
        const headers = {
            "Content-Type": "application/json",
            ...customHeaders
        };
        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }
        return headers;
    }

    static async request(endpoint, options = {}) {
        const url = `${API_URL}${endpoint}`;
        const headers = this.getHeaders(options.headers);
        
        try {
            const response = await fetch(url, { ...options, headers });
            
            // Handle unauthorized (session expired)
            if (response.status === 401) {
                console.warn("Unauthorized API call, clearing session.");
                sessionStorage.clear();
                window.location.reload();
                return { error: "Session expired. Please log in again." };
            }

            const isJson = response.headers.get("content-type")?.includes("application/json");
            const data = isJson ? await response.json() : await response.text();

            if (!response.ok) {
                return { error: data.detail || data.message || "An error occurred", status: response.status, data };
            }

            return { data, status: response.status };
        } catch (error) {
            console.error(`API Client Error [${endpoint}]:`, error);
            return { error: "Connection error. Please try again." };
        }
    }

    static async get(endpoint) {
        return this.request(endpoint, { method: "GET" });
    }

    static async post(endpoint, body) {
        return this.request(endpoint, {
            method: "POST",
            body: JSON.stringify(body)
        });
    }

    static async put(endpoint, body) {
        return this.request(endpoint, {
            method: "PUT",
            body: JSON.stringify(body)
        });
    }

    static async delete(endpoint) {
        return this.request(endpoint, { method: "DELETE" });
    }
}

window.ApiClient = ApiClient;
