import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- Interfaces ---
interface ProjectFile {
  id: string;
  name: string;
  language: string;
  content: string;
}

interface Message {
  role: 'user' | 'model';
  cleanText: string;
  timestamp: Date;
}

// --- Utilities ---
const toBase64 = (str: string): string => {
  try {
    const bytes = new TextEncoder().encode(str);
    let binString = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binString += String.fromCharCode(bytes[i]);
    }
    return btoa(binString);
  } catch (e) { 
    console.error("Base64 encoding failed", e);
    return ""; 
  }
};

const safeMarkdown = (text: string): string => {
  try {
    const marked = (window as any).marked;
    if (marked) return marked.parse(text);
  } catch (e) {}
  return text.replace(/\n/g, '<br/>');
};

const App = () => {
  // --- State ---
  const [activeTab, setActiveTab] = useState<'chat' | 'preview'>('chat');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('gh_token') || '');
  const [repoName, setRepoName] = useState(() => localStorage.getItem('gh_repo') || '');
  const [isPushing, setIsPushing] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Effects ---
  useEffect(() => {
    const loader = document.getElementById('initial-loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 400);
    }
    if (messages.length === 0) {
      setMessages([{
        role: 'model',
        cleanText: "### 🚀 AI Studio v6.6 Stabilized\n\nSelamat datang! Gunakan tab **Chat** untuk mendesain aplikasi Anda. File yang dihasilkan dapat disinkronkan ke GitHub melalui tab **Code**.\n\n**Pengaturan GitHub:**\nKlik ikon ⚙️ di pojok kanan atas untuk memasukkan Token & Nama Repo.",
        timestamp: new Date()
      }]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('gh_token', githubToken);
    localStorage.setItem('gh_repo', repoName);
  }, [githubToken, repoName]);

  useEffect(() => {
    if ((window as any).lucide) (window as any).lucide.createIcons();
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, isGenerating, activeTab]);

  // --- Logic ---
  const extractFiles = (text: string) => {
    const newFiles: ProjectFile[] = [];
    let cleanText = text;
    const regex = /\[FILE:\s*([\w\.\/\-]+)\]\s*[\n\r]*```(\w+)?\s*[\n\r]([\s\S]*?)```/gi;
    const matches = Array.from(text.matchAll(regex));
    
    matches.forEach((m) => {
      newFiles.push({
        id: Math.random().toString(36).substr(2, 9),
        name: m[1].trim(),
        language: (m[2] || 'text').trim(),
        content: m[3].trim()
      });
      cleanText = cleanText.replace(m[0], `\n\n> 📁 **File Updated: \`${m[1]}\`**\n`);
    });
    
    return { newFiles, cleanText };
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || isGenerating) return;
    
    const prompt = inputText;
    setMessages(prev => [...prev, { role: 'user', cleanText: prompt, timestamp: new Date() }]);
    setInputText('');
    setIsGenerating(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { 
          systemInstruction: "You are AI Architect. When generating code, always use this format: [FILE: filename.ext] followed by a code block.",
        }
      });

      const { newFiles, cleanText } = extractFiles(response.text || "");
      
      if (newFiles.length > 0) {
        setProjectFiles(prev => {
          const updated = [...prev];
          newFiles.forEach(nf => {
            const idx = updated.findIndex(f => f.name.toLowerCase() === nf.name.toLowerCase());
            if (idx > -1) updated[idx].content = nf.content;
            else updated.push(nf);
          });
          return updated;
        });
        setActiveFileId(newFiles[0].id);
      }
      
      setMessages(prev => [...prev, { role: 'model', cleanText, timestamp: new Date() }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'model', cleanText: `🛑 **Error:** ${e.message}`, timestamp: new Date() }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const syncToGithub = async () => {
    if (!githubToken || !repoName) {
      setShowSettings(true);
      return;
    }
    
    setIsPushing(true);
    try {
      if (projectFiles.length === 0) throw new Error("Belum ada file untuk dikirim.");
      
      for (const file of projectFiles) {
        const url = `https://api.github.com/repos/${repoName}/contents/${file.name}`;
        let sha = null;
        
        try {
          const check = await fetch(url, { 
            headers: { 'Authorization': `token ${githubToken}`, 'Accept': 'application/vnd.github.v3+json' } 
          });
          if (check.ok) {
            const data = await check.json();
            sha = data.sha;
          }
        } catch (e) {}

        const push = await fetch(url, {
          method: 'PUT',
          headers: { 
            'Authorization': `token ${githubToken}`, 
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
          },
          body: JSON.stringify({
            message: `Update via AI Studio: ${file.name}`,
            content: toBase64(file.content),
            sha: sha || undefined
          })
        });

        if (!push.ok) {
          const errData = await push.json();
          throw new Error(errData.message || `Gagal push ${file.name}`);
        }
      }
      alert("✅ Berhasil! Semua file telah disinkronkan ke GitHub.");
    } catch (e: any) { 
      alert(`❌ GitHub Error: ${e.message}`); 
    } finally { 
      setIsPushing(false); 
    }
  };

  const previewDoc = useMemo(() => {
    const htmlFile = projectFiles.find(f => f.name.toLowerCase().endsWith('.html'));
    if (!htmlFile) return null;
    
    const css = projectFiles.filter(f => f.name.toLowerCase().endsWith('.css')).map(f => `<style>${f.content}</style>`).join('\n');
    const js = projectFiles.filter(f => f.name.toLowerCase().endsWith('.js')).map(f => `<script type="module">${f.content}<\/script>`).join('\n');
    
    const bodyMatch = htmlFile.content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : htmlFile.content;
    
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script>${css}</head><body>${bodyContent}${js}</body></html>`;
  }, [projectFiles]);

  return (
    <div className="flex flex-col h-screen w-full bg-white text-[#1f2937] font-sans overflow-hidden">
      {/* --- Header --- */}
      <header className="h-16 bg-white border-b border-gray-100 flex items-center justify-between px-6 shrink-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
            <i data-lucide="blocks" className="w-5 h-5"></i>
          </div>
          <span className="text-lg font-bold tracking-tight text-gray-900">AI Architect</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowSettings(true)} className="p-2.5 hover:bg-gray-50 rounded-xl transition-colors text-gray-500 active:scale-95">
            <i data-lucide="settings" className="w-5 h-5"></i>
          </button>
          <button onClick={() => window.location.reload()} className="p-2.5 hover:bg-gray-50 rounded-xl transition-colors text-gray-500 active:scale-95">
            <i data-lucide="refresh-cw" className="w-5 h-5"></i>
          </button>
        </div>
      </header>

      {/* --- Tab Selector --- */}
      <div className="bg-white px-6 py-3 shrink-0 flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-gray-50">
        <button 
          onClick={() => setActiveTab('chat')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === 'chat' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          Chat
        </button>
        <button 
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${activeTab === 'preview' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
        >
          Code & Sync
        </button>
      </div>

      {/* --- Main Area --- */}
      <main className="flex-1 overflow-hidden relative flex flex-col">
        {activeTab === 'chat' ? (
          <div className="h-full flex flex-col">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-8 bg-white custom-scrollbar">
              {messages.map((m, i) => (
                <div key={i} className="animate-in max-w-3xl mx-auto w-full">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${m.role === 'user' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{m.role === 'user' ? 'You' : 'Architect'}</span>
                    </div>
                    <div className="text-gray-800 text-[15px] leading-relaxed">
                      <div className="prose prose-sm max-w-none prose-slate" dangerouslySetInnerHTML={{ __html: safeMarkdown(m.cleanText) }} />
                    </div>
                  </div>
                </div>
              ))}
              {isGenerating && (
                <div className="max-w-3xl mx-auto w-full flex items-center gap-3 p-4 bg-blue-50/50 rounded-2xl text-blue-600 text-xs font-medium">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  Generating implementation...
                </div>
              )}
            </div>
            
            <div className="p-6 bg-white border-t border-gray-100 pb-10 shrink-0">
              <div className="max-w-3xl mx-auto relative group">
                <textarea 
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder="Ask for features, UI design, or full apps..."
                  className="w-full bg-gray-50 rounded-3xl px-6 py-4 text-[15px] outline-none resize-none min-h-[60px] max-h-40 border border-transparent focus:border-blue-200 focus:bg-white focus:shadow-sm transition-all pr-14"
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                />
                <button 
                  onClick={handleSendMessage} 
                  disabled={isGenerating || !inputText.trim()} 
                  className={`absolute bottom-3 right-3 p-2.5 rounded-2xl transition-all ${isGenerating ? 'bg-gray-200 text-gray-400' : 'bg-blue-600 text-white shadow-lg active:scale-95 disabled:opacity-20'}`}
                >
                  <i data-lucide="send" className="w-4 h-4"></i>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col bg-[#fcfcfd]">
            <div className="p-4 border-b border-gray-100 bg-white flex gap-3 overflow-x-auto no-scrollbar shadow-sm">
              <button 
                onClick={syncToGithub} 
                disabled={isPushing} 
                className="bg-[#24292e] text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                <i data-lucide="github" className="w-4 h-4"></i>
                {isPushing ? "Syncing..." : "Sync to GitHub"}
              </button>
              {previewDoc && (
                <button 
                  onClick={() => {
                    const win = window.open("", "_blank");
                    if (win) { win.document.write(previewDoc); win.document.close(); }
                  }} 
                  className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold uppercase active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap shadow-sm hover:opacity-90"
                >
                  <i data-lucide="external-link" className="w-4 h-4"></i>
                  Live Preview
                </button>
              )}
            </div>
            
            <div className="flex-1 flex overflow-hidden">
              {/* File Sidebar */}
              <div className="w-56 border-r border-gray-100 bg-white overflow-y-auto custom-scrollbar p-3 space-y-1">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-3 mb-3">Workspace</div>
                {projectFiles.length === 0 && <div className="text-xs text-gray-300 px-3 italic">No files yet</div>}
                {projectFiles.map(f => (
                  <button 
                    key={f.id} 
                    onClick={() => setActiveFileId(f.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono truncate transition-all ${activeFileId === f.id ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              
              {/* Code Editor Area */}
              <div className="flex-1 overflow-auto bg-white p-8 font-mono text-sm leading-relaxed text-gray-800 custom-scrollbar selection:bg-blue-100">
                {activeFileId ? (
                  <pre className="whitespace-pre-wrap">{projectFiles.find(f => f.id === activeFileId)?.content}</pre>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-gray-300 gap-4 opacity-40">
                    <i data-lucide="file-code" className="w-12 h-12"></i>
                    <p className="text-sm font-medium">Select a file from the sidebar to view code</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* --- Settings Modal --- */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/40 z-[100] flex items-center justify-center p-6 backdrop-blur-sm animate-in">
          <div className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl p-8 border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-gray-900">GitHub Config</h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <i data-lucide="x" className="w-5 h-5 text-gray-400"></i>
              </button>
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-400 uppercase px-1 tracking-widest">Personal Access Token</label>
                <input 
                  type="password" 
                  value={githubToken} 
                  onChange={e => setGithubToken(e.target.value)} 
                  placeholder="ghp_xxxxxxxxxxxx" 
                  className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 ring-blue-500/10 focus:bg-white transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-gray-400 uppercase px-1 tracking-widest">Repository (user/repo)</label>
                <input 
                  type="text" 
                  value={repoName} 
                  onChange={e => setRepoName(e.target.value)} 
                  placeholder="username/my-project" 
                  className="w-full bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 text-sm outline-none focus:ring-2 ring-blue-500/10 focus:bg-white transition-all"
                />
              </div>
              <button 
                onClick={() => setShowSettings(false)} 
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-blue-500/20 active:scale-95 transition-all mt-4"
              >
                Save Configuration
              </button>
            </div>
            <p className="text-[10px] text-center text-gray-400 mt-6 leading-relaxed">
              Tokens are stored locally in your browser and are never sent to our servers.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}