import { Subject, BehaviorSubject } from 'rxjs';

class WebsocketService {
    constructor() {
        this.socket = null;
        this.isConnected$ = new BehaviorSubject(false);
        this.messageReceived$ = new Subject();
        this.reconnectTimer = null;
    }

    connect(url = 'ws://127.0.0.1:8000/listen') {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
        
        this.socket = new WebSocket(url);

        this.socket.onopen = () => {
            console.log('[WS] Connected');
            this.isConnected$.next(true);
            if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        };

        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.messageReceived$.next(data);
            } catch (err) {
                console.error("[WS] Parse error", err);
            }
        };

        this.socket.onclose = () => {
            console.log('[WS] Disconnected');
            this.isConnected$.next(false);
            this.socket = null;
            // Retries
            this.reconnectTimer = setTimeout(() => this.connect(url), 3000);
        };

        this.socket.onerror = (error) => {
            console.error('[WS] Error', error);
        };
    }

    sendJSON(payload) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(payload));
        }
    }

    sendBinary(blob) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(blob);
        }
    }

    disconnect() {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    }
}

export const websocketService = new WebsocketService();
