import React, { createContext, useContext, useEffect, useState } from "react";
import { reconnectSocket } from "../lib/socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const savedToken = localStorage.getItem("medibook_token");
    const savedUser = localStorage.getItem("medibook_user");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
      reconnectSocket(savedToken);
    }
    setLoading(false);
  }, []);

  function login(newToken, newUser) {
    localStorage.setItem("medibook_token", newToken);
    localStorage.setItem("medibook_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    reconnectSocket(newToken);
  }

  function logout() {
    api.logout().catch(() => {});
    localStorage.removeItem("medibook_token");
    localStorage.removeItem("medibook_user");
    setToken(null);
    setUser(null);
    reconnectSocket(null);
  }


  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
