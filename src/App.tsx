import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Headphones, Pause, Play, Moon, Sun, Search, Globe, MapPin, Volume2, Home } from "lucide-react";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

interface NewsItem {
  headline: string;
  summary: string;
}

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [language, setLanguage] = useState<'English' | 'Hindi'>('English');
  const [region, setRegion] = useState<'India' | 'Punjab'>('India');
  const [customTopic, setCustomTopic] = useState('');
  const [activeTab, setActiveTab] = useState<'region' | 'search'>('region');
  const [voiceSettings, setVoiceSettings] = useState<'Device' | 'Fenrir' | 'Kore'>('Device');
  
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isFetchingAudio, setIsFetchingAudio] = useState(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(-1);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playSessionRef = useRef<number>(0);

  const cleanupGeminiAudio = () => {
    if (currentSourceRef.current) {
        try {
            currentSourceRef.current.stop();
        } catch (e) {
            // ignore if already stopped
        }
        currentSourceRef.current.disconnect();
        currentSourceRef.current = null;
    }
  };
  
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Handle TTS
  const playNews = async (index: number) => {
    if (newsItems.length === 0) return;
    
    playSessionRef.current += 1;
    const currentSession = playSessionRef.current;
    
    // Stop any existing speech
    window.speechSynthesis.cancel();
    cleanupGeminiAudio();
    
    const item = newsItems[index];
    if (!item) {
      setIsPlaying(false);
      setCurrentPlayingIndex(-1);
      return;
    }
    
    setCurrentPlayingIndex(index);
    setIsPlaying(true);
    setIsPaused(false);
    
    const textToRead = `${item.headline}. ${item.summary}`;
    
    if (voiceSettings === 'Device') {
      const utterance = new SpeechSynthesisUtterance(textToRead);
      
      // Attempt to select language voice - prefer realistic/natural sounding ones
      const voices = window.speechSynthesis.getVoices();
      const targetLang = language === 'Hindi' ? 'hi-IN' : 'en-';
      
      // Sort logic to prefer Google or "Natural" / "Premium" voices
      const availableVoices = voices.filter(v => v.lang.startsWith(targetLang));
      
      const selectedVoice = availableVoices.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        
        const getScore = (name: string) => {
          let score = 0;
          if (name.includes('premium') || name.includes('natural') || name.includes('enhanced')) score += 10;
          if (name.includes('google')) score += 5;
          if (name.includes('female')) score += 2; // general preference for clarity in news
          return score;
        };
        
        return getScore(bName) - getScore(aName);
      })[0];

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      
      // Set properties for a more natural cadence
      utterance.rate = 0.95; // Slightly slower for news reading clarity
      utterance.pitch = 1.0;
      utterance.lang = language === 'Hindi' ? 'hi-IN' : 'en-US';
      
      utterance.onend = () => {
        if (currentSession !== playSessionRef.current) return;
        // Play next automatically
        if (index + 1 < newsItems.length) {
          playNews(index + 1);
        } else {
          setIsPlaying(false);
          setIsPaused(false);
          setCurrentPlayingIndex(-1);
        }
      };
      
      // Safety timeout in case onend doesn't fire cleanly
      utterance.onerror = (e) => {
        if (currentSession !== playSessionRef.current) return;
        console.error("Speech synthesis error", e);
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentPlayingIndex(-1);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      // Gemini TTS
      try {
        setIsFetchingAudio(true);
        const ttsResponse = await ai.models.generateContent({
          model: "gemini-3.1-flash-tts-preview",
          contents: [{ parts: [{ text: textToRead }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceSettings },
              },
            },
          },
        });
        
        if (currentSession !== playSessionRef.current) return;
        
        const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error("No audio returned");
        
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const int16Array = new Int16Array(bytes.buffer);
        
        if (!audioCtxRef.current) {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          audioCtxRef.current = new AudioContextClass();
        } else if (audioCtxRef.current.state === "suspended") {
          await audioCtxRef.current.resume();
        }
        
        const audioBuffer = audioCtxRef.current.createBuffer(1, int16Array.length, 24000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16Array.length; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }
        
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtxRef.current.destination);
        
        source.onended = () => {
          if (currentSession !== playSessionRef.current) return;
          if (index + 1 < newsItems.length) {
             playNews(index + 1);
          } else {
             setIsPlaying(false);
             setIsPaused(false);
             setCurrentPlayingIndex(-1);
          }
        };
        
        currentSourceRef.current = source;
        source.start();
        
      } catch (err) {
        if (currentSession !== playSessionRef.current) return;
        console.error("Gemini TTS Error", err);
        setIsPlaying(false);
        setIsPaused(false);
        setCurrentPlayingIndex(-1);
      } finally {
        if (currentSession === playSessionRef.current) {
          setIsFetchingAudio(false);
        }
      }
    }
  };
  
  const pauseNews = () => {
    if (voiceSettings === 'Device') {
      window.speechSynthesis.pause();
    } else {
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
        audioCtxRef.current.suspend();
      }
    }
    setIsPaused(true);
  };

  const resumeNews = () => {
    if (voiceSettings === 'Device') {
      window.speechSynthesis.resume();
    } else {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
    }
    setIsPaused(false);
  };
  
  const stopNews = () => {
    playSessionRef.current += 1;
    window.speechSynthesis.cancel();
    cleanupGeminiAudio();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentPlayingIndex(-1);
  };

  const goHome = () => {
    stopNews();
    setNewsItems([]);
    setCustomTopic('');
    setActiveTab('region');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  const fetchNews = async () => {
    // Determine search target
    const targetQuery = activeTab === 'region' ? region : (customTopic.trim() || 'Latest headlining news');
  
    setIsFetching(true);
    setNewsItems([]);
    stopNews();
    
    try {
      const contentPrompt = `Find the top 3 most important, recently published news articles about "${targetQuery}".
Language to output: ${language}.
Provide a short, catchy headline and a 2-3 sentence conversational summary for each, designed to be easily read out loud by a TTS system.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: contentPrompt,
        config: {
          tools: [{ googleSearch: {} }],
          toolConfig: { includeServerSideToolInvocations: true },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                headline: { type: Type.STRING, description: "The news headline." },
                summary: { type: Type.STRING, description: "Conversational summary of the news." }
              },
              required: ["headline", "summary"]
            }
          }
        }
      });
      
      const jsonStr = response.text?.trim() || "[]";
      let parsed = [] as NewsItem[];
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        console.error("Failed to parse JSON result from Gemini", e);
      }
      
      setNewsItems(parsed);
      
    } catch (err) {
      console.error(err);
      alert("Failed to fetch news. Please make sure the API key is valid.");
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
      {/* Header */}
      <header className="flex items-center justify-between p-4 md:p-5 border-b border-border shadow-sm sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" onClick={goHome} className="rounded-full hover:bg-muted mr-1" title="Home">
            <Home className="w-5 h-5 text-muted-foreground" />
          </Button>
          <div className="bg-gradient-to-br from-sky-500 to-blue-600 text-white p-2 rounded-[12px]">
            <Headphones className="w-5 h-5" />
          </div>
          <h1 className="text-[20px] font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-sky-500 to-blue-600 uppercase hidden sm:block">AudioNews</h1>
        </div>
        <div className="flex items-center gap-2 bg-card p-1 rounded-full border border-border/50">
          <Sun className="w-4 h-4 text-muted-foreground ml-2" />
          <Switch checked={isDarkMode} onCheckedChange={setIsDarkMode} className="data-[state=checked]:bg-primary" />
          <Moon className="w-4 h-4 text-muted-foreground mr-2" />
        </div>
      </header>
    
      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-8 animate-in fade-in duration-500">
        
        <Card className="border-0 shadow-lg bg-card/40 backdrop-blur-md rounded-[24px]">
          <CardHeader>
            <CardTitle>What would you like to hear?</CardTitle>
            <CardDescription>Select your preferences for the latest updates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            <div className="space-y-3">
              <Label className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                <Volume2 className="w-4 h-4" /> Voice Engine
              </Label>
              <RadioGroup value={voiceSettings} onValueChange={(v) => setVoiceSettings(v as any)} className="flex gap-4 overflow-x-auto pb-2 snap-x">
                <div className={`snap-center flex items-center justify-center space-x-2 p-2 px-4 rounded-[20px] flex-none border transition-all ${voiceSettings === 'Device' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                  <RadioGroupItem value="Device" id="v-dev" className="border-current" />
                  <Label htmlFor="v-dev" className="cursor-pointer font-semibold text-[13px] tracking-wide whitespace-nowrap">Local Device</Label>
                </div>
                <div className={`snap-center flex items-center justify-center space-x-2 p-2 px-4 rounded-[20px] flex-none border transition-all ${voiceSettings === 'Fenrir' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                  <RadioGroupItem value="Fenrir" id="v-fen" className="border-current" />
                  <Label htmlFor="v-fen" className="cursor-pointer font-semibold text-[13px] tracking-wide whitespace-nowrap">Fenrir (AI)</Label>
                </div>
                <div className={`snap-center flex items-center justify-center space-x-2 p-2 px-4 rounded-[20px] flex-none border transition-all ${voiceSettings === 'Kore' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                  <RadioGroupItem value="Kore" id="v-kor" className="border-current" />
                  <Label htmlFor="v-kor" className="cursor-pointer font-semibold text-[13px] tracking-wide whitespace-nowrap">Kore (AI)</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                 Language
              </Label>
              <RadioGroup value={language} onValueChange={(v) => setLanguage(v as any)} className="flex gap-4">
                <div className={`flex items-center space-x-2 p-2 px-4 rounded-[20px] flex-1 border transition-all ${language === 'English' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                  <RadioGroupItem value="English" id="r-eng" className="border-current" />
                  <Label htmlFor="r-eng" className="flex-1 cursor-pointer font-semibold text-[13px] tracking-wide">English</Label>
                </div>
                <div className={`flex items-center space-x-2 p-2 px-4 rounded-[20px] flex-1 border transition-all ${language === 'Hindi' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                  <RadioGroupItem value="Hindi" id="r-hin" className="border-current" />
                  <Label htmlFor="r-hin" className="flex-1 cursor-pointer font-semibold text-[13px] tracking-wide">Hindi (हिंदी)</Label>
                </div>
              </RadioGroup>
            </div>
    
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="region">Regional News</TabsTrigger>
                <TabsTrigger value="search">Custom Topic</TabsTrigger>
              </TabsList>
              
              <TabsContent value="region" className="space-y-4 animate-in slide-in-from-left-2">
                <Label className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                   Location
                </Label>
                <RadioGroup value={region} onValueChange={(v) => setRegion(v as any)} className="flex gap-4">
                  <div className={`flex items-center space-x-2 p-2 px-4 rounded-[20px] flex-1 border transition-all ${region === 'India' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                    <RadioGroupItem value="India" id="r-india" className="border-current" />
                    <Label htmlFor="r-india" className="flex-1 cursor-pointer flex items-center gap-2 font-semibold text-[13px] tracking-wide">
                      <Globe className="w-4 h-4 text-inherit" /> India
                    </Label>
                  </div>
                  <div className={`flex items-center space-x-2 p-2 px-4 rounded-[20px] flex-1 border transition-all ${region === 'Punjab' ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border hover:border-primary/50 text-muted-foreground'}`}>
                    <RadioGroupItem value="Punjab" id="r-pun" className="border-current" />
                    <Label htmlFor="r-pun" className="flex-1 cursor-pointer flex items-center gap-2 font-semibold text-[13px] tracking-wide">
                      <MapPin className="w-4 h-4 text-inherit" /> Punjab
                    </Label>
                  </div>
                </RadioGroup>
              </TabsContent>
    
              <TabsContent value="search" className="space-y-4 animate-in slide-in-from-right-2">
                <Label htmlFor="topicSearch" className="text-sm font-semibold flex items-center gap-2 text-muted-foreground uppercase tracking-wider">
                   Search Topic
                </Label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input 
                    id="topicSearch"
                    placeholder="e.g. Technology, Sports, Space..." 
                    className="pl-11 h-12 rounded-[12px] bg-card border-border text-[14px]"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') fetchNews();
                    }}
                  />
                </div>
              </TabsContent>
            </Tabs>
            
            <Button 
              size="lg" 
              className="w-full text-[15px] font-bold h-12 shadow-lg hover:shadow-xl transition-all active:scale-[0.98] bg-gradient-to-br from-sky-500 to-blue-600 text-white rounded-[12px] border-0"
              onClick={fetchNews}
              disabled={isFetching}
            >
              {isFetching ? (
                <span className="flex items-center gap-2">
                   <span className="animate-spin rounded-full h-4 w-4 border-2 border-primary-foreground border-t-transparent"></span>
                   Finding latest news...
                </span>
              ) : (
                 <span className="flex items-center gap-2">
                   <Search className="w-5 h-5" />
                   Get Latest News
                 </span>
              )}
            </Button>
          </CardContent>
        </Card>
    
        {/* Results Section */}
        {newsItems.length > 0 && !isFetching && (
          <div className="space-y-6 animate-in slide-in-from-bottom-4 fade-in duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight border-l-4 border-primary pl-3 hidden sm:block">
                 Your Update Stream
              </h2>
              <div className="flex gap-2 w-full sm:w-auto justify-end">
                {isPlaying ? (
                  <>
                    {isPaused ? (
                      <Button variant="outline" size="sm" onClick={resumeNews} className="rounded-full px-4 border-primary text-primary shadow-sm hover:bg-primary/10">
                        <Play className="w-4 h-4 mr-2" /> Resume
                      </Button>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={pauseNews} className="rounded-full px-4 border shadow-sm">
                        <Pause className="w-4 h-4 mr-2" /> Pause
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={stopNews} className="rounded-full px-4 shadow-sm">
                      <span className="w-2.5 h-2.5 bg-white mr-2 rounded-sm" /> Stop
                    </Button>
                  </>
                ) : (
                  <Button variant="default" size="sm" onClick={() => playNews(0)} className="rounded-full px-4 shadow-md bg-gradient-to-br from-sky-500 to-blue-600 text-white border-0">
                    <Play className="w-4 h-4 mr-2" /> Listen All
                  </Button>
                )}
              </div>
            </div>
            
            <div className="grid gap-4">
              {newsItems.map((item, idx) => (
                <Card key={idx} className={`overflow-hidden rounded-[20px] transition-all duration-300 border-border relative ${currentPlayingIndex === idx ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02] shadow-xl' : 'shadow-sm hover:shadow-md'}`}>
                   <div className={`h-1 w-full transition-opacity bg-gradient-to-r from-sky-500 to-blue-600 ${currentPlayingIndex === idx ? 'opacity-100' : 'opacity-0'}`} />
                   <CardContent className="p-4 md:p-5 flex flex-col gap-2 relative">
                     <span className="text-[10px] font-bold uppercase text-primary tracking-[0.5px]">UPDATE</span>
                     <h3 className="font-semibold text-[15px] leading-[1.4] text-foreground">{item.headline}</h3>
                     <p className="text-muted-foreground text-sm leading-relaxed mt-1">{item.summary}</p>
                     
                     <div className="flex justify-end pt-3">
                        {currentPlayingIndex === idx && isPlaying ? (
                           <div className="flex items-center gap-2">
                             {isPaused ? (
                                <Button variant="default" size="sm" onClick={resumeNews} className="rounded-full bg-gradient-to-br from-sky-500 to-blue-600 shadow-md">
                                  <Play className="w-3.5 h-3.5 mr-1" /> Resume
                                </Button>
                             ) : (
                                <Button variant="outline" size="sm" onClick={pauseNews} className="rounded-full bg-card">
                                  <Pause className="w-3.5 h-3.5 mr-1" /> Pause
                                </Button>
                             )}
                             <div className={`text-[11px] font-extrabold uppercase tracking-widest px-3 py-1.5 rounded-full flex items-center gap-1 ${isPaused ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                               {isFetchingAudio ? <><span className="animate-spin rounded-full h-3 w-3 border-2 border-primary border-t-transparent"></span> Buffering</> : isPaused ? 'Paused' : <><Volume2 className="w-4 h-4 animate-pulse" /> Playing</>}
                             </div>
                           </div>
                        ) : (
                           <Button variant="default" size="sm" onClick={() => playNews(idx)} className="rounded-full bg-gradient-to-br from-sky-500 to-blue-600 shadow-md border-0 text-white">
                             <Play className="w-4 h-4 mr-1" /> Play This
                           </Button>
                        )}
                     </div>
                   </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
    
        {isFetching && (
          <div className="space-y-6">
             <h2 className="text-2xl font-bold tracking-tight border-l-4 border-muted pl-3 text-muted-foreground">
               Gathering updates...
            </h2>
            <div className="grid gap-4">
              {[1, 2, 3].map(i => (
                <Card key={i} className="overflow-hidden rounded-[20px] border-border shadow-sm">
                   <CardContent className="p-4 md:p-5 flex flex-col gap-3 relative">
                     <Skeleton className="h-3 w-16" />
                     <Skeleton className="h-5 w-full" />
                     <Skeleton className="h-4 w-5/6" />
                     <div className="flex justify-end pt-2">
                       <Skeleton className="h-8 w-24 rounded-full" />
                     </div>
                   </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
