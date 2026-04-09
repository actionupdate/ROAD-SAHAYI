import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AlertTriangle, 
  Wrench, 
  Truck, 
  Fuel, 
  CircleDot, 
  MessageSquare, 
  Phone, 
  Star, 
  Navigation, 
  CheckCircle2, 
  X, 
  Menu,
  User as UserIcon,
  LogOut,
  MapPin,
  CreditCard,
  Wallet,
  Banknote,
  Languages,
  ChevronRight,
  ArrowLeft,
  Shield,
  Heart,
  Flame,
  Send,
  Clock,
  Lock,
  ShieldCheck
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Toaster, toast } from 'sonner';
import './i18n';

import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut,
  signInAnonymously,
  collection,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  serverTimestamp,
  handleFirestoreError,
  OperationType,
  getDocs
} from './firebase';
import { cn } from './lib/utils';

// Types
type Role = 'customer' | 'provider';
type RequestStatus = 'pending' | 'accepted' | 'in-progress' | 'completed' | 'cancelled';
type ServiceCategory = 'tyre' | 'towing' | 'fuel' | 'mechanic';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: Role;
  phoneNumber?: string;
  rating?: number;
  reviewCount?: number;
  isOnline?: boolean;
  location?: { lat: number; lng: number };
  serviceCategories?: ServiceCategory[];
  basePrices?: Partial<Record<ServiceCategory, number>>;
  securityPin?: string;
  failedPinAttempts?: number;
  isLocked?: boolean;
}

interface ServiceRequest {
  id: string;
  customerId: string;
  customerName?: string;
  customerPhoto?: string;
  providerId?: string;
  providerName?: string;
  category: ServiceCategory;
  status: RequestStatus;
  location: { lat: number; lng: number };
  address: string;
  createdAt: any;
  acceptedAt?: any;
  completedAt?: any;
  price?: number;
  paymentStatus?: 'pending' | 'paid';
  paymentMethod?: 'upi' | 'card' | 'cash';
  rating?: number;
  review?: string;
  distance?: number;
  basePrice?: number;
  distancePrice?: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  type?: 'text' | 'location';
  timestamp: any;
}

const SERVICE_PRICE_RANGES: Record<ServiceCategory, { min: number; max: number }> = {
  tyre: { min: 200, max: 400 },
  towing: { min: 800, max: 2000 },
  fuel: { min: 85, max: 110 },
  mechanic: { min: 499, max: 2899 }
};

const SERVICE_BASE_PRICES: Record<ServiceCategory, number> = {
  tyre: 200,
  towing: 800,
  fuel: 85,
  mechanic: 499
};

const DISTANCE_RATE = 20; // ₹20 per km (Kerala Affordable Rate)

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function calculateETA(distance: number) {
  // Average speed in Kerala traffic (km/h)
  const avgSpeed = 30; 
  // Traffic multiplier (randomized for simulation, or could be based on time of day)
  const trafficMultiplier = 1.2 + Math.random() * 0.5; 
  const timeHours = (distance / avgSpeed) * trafficMultiplier;
  const timeMinutes = Math.round(timeHours * 60);
  
  // Add a minimum of 5 minutes for preparation/dispatch
  return Math.max(5, timeMinutes + 5);
}

export default function App() {
  const { t, i18n } = useTranslation();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState({ lat: 10.8505, lng: 76.2711 }); // Default to Kerala
  const [activeRequest, setActiveRequest] = useState<ServiceRequest | null>(null);
  const [onlineWorkers, setOnlineWorkers] = useState<UserProfile[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [view, setView] = useState<'home' | 'request' | 'dashboard' | 'profile' | 'worker-portal'>('home');
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | null>(null);
  const [workerCode, setWorkerCode] = useState('');
  const [securityPin, setSecurityPin] = useState('');
  const [workerStep, setWorkerStep] = useState<'code' | 'pin'>('code');
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [isVerifyingWorker, setIsVerifyingWorker] = useState(false);
  const [workerError, setWorkerError] = useState('');
  const [logoClicks, setLogoClicks] = useState(0);
  const [showSOSModal, setShowSOSModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState<{ role: Role, accessCode?: string, categories?: ServiceCategory[] } | null>(null);
  const prevRequestStatus = useRef<RequestStatus | null>(null);

  // Request Notification Permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const sendNotification = (title: string, body: string) => {
    // In-app toast
    toast.info(title, { description: body });

    // Browser push notification
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  };

  // Consolidate handleLogin to be simpler and more robust
  useEffect(() => {
    if (!user || user.role !== 'customer' || !activeRequest || activeRequest.status !== 'pending') {
      setOnlineWorkers([]);
      return;
    }

    const q = query(
      collection(db, 'users'),
      where('role', '==', 'provider'),
      where('isOnline', '==', true),
      where('serviceCategories', 'array-contains', activeRequest.category)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const workers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile));
      setOnlineWorkers(workers);
    });

    return () => unsubscribe();
  }, [user, activeRequest]);

  const handleLogin = async (role: Role, accessCode?: string, categories?: ServiceCategory[], guestName?: string, skipViewChange: boolean = false) => {
    if (role === 'provider' && !guestName) {
      const masterCode = import.meta.env.VITE_WORKER_CODE || 'RESCUE2026';
      const categoryCodes: Record<string, ServiceCategory[]> = {
        'TYRE2026': ['tyre'],
        'TOW2026': ['towing'],
        'FUEL2026': ['fuel'],
        'MECH2026': ['mechanic'],
      };

      const validCode = accessCode === masterCode || (accessCode && categoryCodes[accessCode]);
      if (!validCode) {
        toast.error("Invalid Access Code");
        return null;
      }
    }

    try {
      let firebaseUser;
      if (guestName) {
        const result = await signInAnonymously(auth);
        firebaseUser = result.user;
      } else {
        const result = await signInWithPopup(auth, googleProvider);
        firebaseUser = result.user;
      }
      
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      let currentUserProfile: UserProfile;

      const finalCategories = categories || (role === 'provider' ? ['tyre', 'towing', 'fuel', 'mechanic'] : []);

      if (!userDoc.exists()) {
        currentUserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: guestName || firebaseUser.displayName || 'User',
          photoURL: firebaseUser.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${firebaseUser.uid}`,
          role: role,
          isOnline: role === 'provider',
          serviceCategories: finalCategories
        };
        await setDoc(doc(db, 'users', firebaseUser.uid), currentUserProfile);
      } else {
        const existingUser = userDoc.data() as UserProfile;
        // If they are logging in via worker portal, ensure they get the provider role and correct categories
        if (role === 'provider') {
          const updates: any = { role: 'provider', isOnline: true, serviceCategories: finalCategories };
          if (guestName) updates.displayName = guestName;
          await updateDoc(doc(db, 'users', firebaseUser.uid), updates);
          currentUserProfile = { ...existingUser, ...updates };
        } else {
          currentUserProfile = existingUser;
          if (guestName) {
            await updateDoc(doc(db, 'users', firebaseUser.uid), { displayName: guestName });
            currentUserProfile.displayName = guestName;
          }
        }
      }
      
      setUser(currentUserProfile);
      if (!skipViewChange) {
        setView('home');
      }
      toast.success(`Logged in as ${currentUserProfile.role}`);
      return currentUserProfile;
    } catch (error) {
      console.error(error);
      toast.error("Login failed");
      return null;
    }
  };

  const handleLogoClick = () => {
    const newClicks = logoClicks + 1;
    if (newClicks >= 5) {
      if (user?.role === 'provider') {
        setView('home');
        toast.info("You are already in the Worker Dashboard");
      } else {
        setView('worker-portal');
        setWorkerStep('code');
        toast.info("Worker Portal Unlocked");
      }
      setLogoClicks(0);
    } else {
      setLogoClicks(newClicks);
      // Reset clicks after 2 seconds of inactivity
      setTimeout(() => setLogoClicks(0), 2000);
    }
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setUser(userDoc.data() as UserProfile);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Location Tracking
  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const newLoc = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setCurrentLocation(newLoc);
          
          // Update user location in DB if online
          if (user?.uid && user.isOnline) {
            updateDoc(doc(db, 'users', user.uid), { location: newLoc }).catch(e => console.error(e));
          }
        },
        (error) => console.error("Location error:", error),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [user?.uid, user?.isOnline]);

  // Active Request Listener (Customer)
  useEffect(() => {
    if (user?.role === 'customer' && user.uid) {
      const q = query(
        collection(db, 'requests'),
        where('customerId', '==', user.uid),
        where('status', 'in', ['pending', 'accepted', 'in-progress']),
        orderBy('createdAt', 'desc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const data = snapshot.docs[0].data() as ServiceRequest;
          const newRequest = { id: snapshot.docs[0].id, ...data } as ServiceRequest;
          
          // Check for status changes
          if (prevRequestStatus.current && prevRequestStatus.current !== newRequest.status) {
            if (newRequest.status === 'accepted') {
              sendNotification(t('providerFound'), `${newRequest.providerName || 'A provider'} has accepted your request.`);
            } else if (newRequest.status === 'in-progress') {
              sendNotification('Service Started', 'The provider has started the service.');
            } else if (newRequest.status === 'completed') {
              sendNotification('Service Completed', 'Your service request has been marked as completed.');
            }
          }
          
          prevRequestStatus.current = newRequest.status;
          setActiveRequest(newRequest);
        } else {
          prevRequestStatus.current = null;
          setActiveRequest(null);
        }
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'requests'));
      
      return unsubscribe;
    }
  }, [user?.role, user?.uid, t]);

  // Active Request Listener (Provider)
  useEffect(() => {
    if (user?.role === 'provider' && user.uid) {
      const q = query(
        collection(db, 'requests'),
        where('providerId', '==', user.uid),
        where('status', 'in', ['accepted', 'in-progress']),
        orderBy('createdAt', 'desc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const data = snapshot.docs[0].data() as ServiceRequest;
          const newRequest = { id: snapshot.docs[0].id, ...data } as ServiceRequest;

          // Check for status changes
          if (prevRequestStatus.current && prevRequestStatus.current !== newRequest.status) {
            if (newRequest.status === 'in-progress') {
              sendNotification('Service Started', 'You have started the service.');
            } else if (newRequest.status === 'completed') {
              sendNotification('Service Completed', 'The service has been completed.');
            }
          }

          prevRequestStatus.current = newRequest.status;
          setActiveRequest(newRequest);
        } else {
          prevRequestStatus.current = null;
          setActiveRequest(null);
        }
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'requests'));
      
      return unsubscribe;
    }
  }, [user?.role, user?.uid]);

  // Chat Messages Listener
  useEffect(() => {
    if (activeRequest?.id && showChat) {
      const q = query(
        collection(db, 'requests', activeRequest.id, 'messages'),
        orderBy('timestamp', 'asc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatMessage));
        setMessages(msgs);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `requests/${activeRequest.id}/messages`));
      
      return unsubscribe;
    }
  }, [activeRequest?.id, showChat]);

  const handleLogout = () => {
    signOut(auth);
    setUser(null);
    setIsPinVerified(false);
    setView('home');
  };

  const verifyAndLoginWorker = async () => {
    const masterCode = import.meta.env.VITE_WORKER_CODE || 'RESCUE2026';
    const categoryCodes: Record<string, ServiceCategory[]> = {
      'TYRE2026': ['tyre'],
      'TOW2026': ['towing'],
      'FUEL2026': ['fuel'],
      'MECH2026': ['mechanic'],
    };

    let categories: ServiceCategory[] | undefined;
    if (workerCode === masterCode) {
      categories = ['tyre', 'towing', 'fuel', 'mechanic'];
    } else if (categoryCodes[workerCode]) {
      categories = categoryCodes[workerCode];
    }

    if (categories) {
      setWorkerError('');
      setIsVerifyingWorker(true);
      try {
        const loggedInUser = await handleLogin('provider', workerCode, categories, undefined, true);
        if (loggedInUser) {
          if (loggedInUser.isLocked) {
            setWorkerError("Account locked due to too many failed attempts.");
            toast.error("Account Locked");
            setIsVerifyingWorker(false);
            return;
          }
          setWorkerStep('pin');
        }
      } catch (error) {
        console.error("Login error:", error);
      } finally {
        setIsVerifyingWorker(false);
      }
    } else {
      setWorkerError("Invalid Worker Access Code");
      toast.error("Invalid Worker Access Code");
    }
  };

  const verifySecurityPin = async () => {
    if (!user || user.role !== 'provider') return;
    
    setIsVerifyingWorker(true);
    try {
      if (!user.securityPin) {
        // First time setting PIN
        if (securityPin.length !== 6) {
          setWorkerError("PIN must be 6 digits");
          return;
        }
        await updateDoc(doc(db, 'users', user.uid), {
          securityPin: securityPin,
          failedPinAttempts: 0
        });
        toast.success("Security PIN set successfully!");
        setIsPinVerified(true);
        setView('home');
      } else {
        // Verifying existing PIN
        if (securityPin === user.securityPin) {
          await updateDoc(doc(db, 'users', user.uid), {
            failedPinAttempts: 0
          });
          toast.success("Identity verified!");
          setIsPinVerified(true);
          setView('home');
        } else {
          const newAttempts = (user.failedPinAttempts || 0) + 1;
          const isLocked = newAttempts >= 5;
          await updateDoc(doc(db, 'users', user.uid), {
            failedPinAttempts: newAttempts,
            isLocked: isLocked
          });
          
          if (isLocked) {
            setWorkerError("Account locked. Contact administrator.");
            toast.error("Account Locked");
          } else {
            setWorkerError(`Invalid PIN. ${5 - newAttempts} attempts remaining.`);
            toast.error("Invalid PIN");
          }
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsVerifyingWorker(false);
      setSecurityPin('');
    }
  };

  // Enforce PIN verification for providers
  useEffect(() => {
    if (user?.role === 'provider' && !isPinVerified && view !== 'worker-portal') {
      setView('worker-portal');
      setWorkerStep('pin');
    }
  }, [user, isPinVerified, view]);

  const toggleOnline = async (prices?: Partial<Record<ServiceCategory, number>>) => {
    if (!user) return;
    try {
      const updates: any = {
        isOnline: !user.isOnline
      };
      if (prices) {
        updates.basePrices = prices;
      }
      await updateDoc(doc(db, 'users', user.uid), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const createRequest = async (category: ServiceCategory) => {
    if (!user) return;
    
    try {
      const basePrice = SERVICE_BASE_PRICES[category];
      const newRequest = {
        customerId: user.uid,
        customerName: user.displayName,
        customerPhoto: user.photoURL,
        category,
        status: 'pending',
        location: currentLocation,
        address: "Current Location", // In real app, use reverse geocoding
        createdAt: serverTimestamp(),
        basePrice,
        price: basePrice, // Initial estimate
        paymentStatus: 'pending'
      };
      
      await addDoc(collection(db, 'requests'), newRequest);
      toast.success(t('requesting'));
      setSelectedCategory(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'requests');
    }
  };

  const updateRequestStatus = async (status: RequestStatus) => {
    if (!activeRequest) return;
    try {
      const updates: any = { status };
      if (status === 'completed') updates.completedAt = serverTimestamp();
      await updateDoc(doc(db, 'requests', activeRequest.id), updates);
      toast.success(t(status));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `requests/${activeRequest.id}`);
    }
  };

  const submitRating = async (rating: number, review: string) => {
    if (!activeRequest) return;
    try {
      await updateDoc(doc(db, 'requests', activeRequest.id), {
        rating,
        review,
        paymentStatus: 'paid'
      });
      toast.success("Thank you for your feedback!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `requests/${activeRequest.id}`);
    }
  };

  const selectProvider = async (provider: UserProfile) => {
    if (!activeRequest) return;
    try {
      const basePrice = provider.basePrices?.[activeRequest.category] || SERVICE_BASE_PRICES[activeRequest.category];
      
      // Calculate distance for final price
      const distance = calculateDistance(
        currentLocation.lat, currentLocation.lng,
        activeRequest.location.lat, activeRequest.location.lng
      );
      const distancePrice = Math.round(distance * DISTANCE_RATE);
      const totalPrice = basePrice + distancePrice;

      await updateDoc(doc(db, 'requests', activeRequest.id), {
        providerId: provider.uid,
        providerName: provider.displayName,
        providerPhoto: provider.photoURL,
        status: 'accepted',
        acceptedAt: serverTimestamp(),
        basePrice,
        distance: Number(distance.toFixed(2)),
        distancePrice,
        price: totalPrice
      });
      toast.success("Rescuer selected!");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `requests/${activeRequest.id}`);
    }
  };

  const sendMessage = async (text: string, type: 'text' | 'location' = 'text') => {
    if (!activeRequest || !user || (!text.trim() && type === 'text')) return;
    try {
      await addDoc(collection(db, 'requests', activeRequest.id, 'messages'), {
        senderId: user.uid,
        senderName: user.displayName,
        text,
        type,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `requests/${activeRequest.id}/messages`);
    }
  };

  const toggleLanguage = () => {
    const newLng = i18n.language === 'en' ? 'ml' : 'en';
    i18n.changeLanguage(newLng);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-950">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], rotate: [0, 180, 360] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-orange-500"
        >
          <AlertTriangle size={48} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 font-sans overflow-hidden flex flex-col">
      <Toaster position="top-center" richColors />
      
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-md z-50">
        <div 
          className="flex items-center gap-2 cursor-pointer select-none"
          onClick={handleLogoClick}
        >
          <div className="p-2 bg-orange-500 rounded-lg text-white">
            <AlertTriangle size={20} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{t('appName')}</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleLanguage}
            className="p-2 hover:bg-zinc-800 rounded-full transition-colors flex items-center gap-2 text-sm"
          >
            <Languages size={18} />
            <span className="uppercase">{i18n.language}</span>
          </button>
          
          {user ? (
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium">{user.displayName}</p>
                <p className="text-xs text-zinc-500 capitalize">{user.role}</p>
              </div>
              <button 
                onClick={() => setView('profile')}
                className="w-10 h-10 rounded-full border-2 border-zinc-700 overflow-hidden"
              >
                <img src={user.photoURL} alt="Profile" referrerPolicy="no-referrer" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button 
                onClick={() => handleLogin('customer')}
                className="px-4 py-2 text-sm font-medium hover:text-orange-500 transition-colors"
              >
                {t('loginAsCustomer')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        {view === 'worker-portal' ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-zinc-950">
            <motion.div
              key={workerStep}
              initial={{ opacity: 0, scale: 0.9, x: workerStep === 'pin' ? 20 : -20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              className="max-w-sm w-full bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-2xl"
            >
              <div className="w-16 h-16 bg-orange-500/10 text-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                {workerStep === 'code' ? <Wrench size={32} /> : <Lock size={32} />}
              </div>
              
              <h2 className="text-2xl font-bold mb-2">
                {workerStep === 'code' ? 'Worker Portal' : 'Security Verification'}
              </h2>
              <p className="text-zinc-400 text-sm mb-8">
                {workerStep === 'code' 
                  ? 'Enter your category-specific access code to log in.' 
                  : user?.securityPin 
                    ? 'Enter your 6-digit security PIN to continue.' 
                    : 'Set a new 6-digit security PIN for your account.'}
              </p>
              
              <div className="space-y-4">
                {workerStep === 'code' ? (
                  <>
                    <input 
                      type="password"
                      value={workerCode}
                      onChange={(e) => {
                        setWorkerCode(e.target.value);
                        if (workerError) setWorkerError('');
                      }}
                      placeholder="Access Code"
                      className={cn(
                        "w-full bg-zinc-800 border rounded-xl px-4 py-3 focus:outline-none transition-colors text-center tracking-widest",
                        workerError ? "border-red-500 focus:border-red-500" : "border-zinc-700 focus:border-orange-500"
                      )}
                    />
                    {workerError && (
                      <motion.p 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-red-500 text-xs font-bold"
                      >
                        {workerError}
                      </motion.p>
                    )}
                    <button 
                      onClick={verifyAndLoginWorker}
                      disabled={isVerifyingWorker}
                      className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-bold transition-all flex items-center justify-center gap-2"
                    >
                      {isVerifyingWorker ? "Verifying..." : (
                        <>
                          Continue <ShieldCheck size={18} />
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex justify-center gap-2">
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <div 
                          key={i}
                          className={cn(
                            "w-3 h-3 rounded-full transition-all duration-300",
                            securityPin.length > i ? "bg-orange-500 scale-125" : "bg-zinc-700"
                          )}
                        />
                      ))}
                    </div>
                    <input 
                      type="password"
                      maxLength={6}
                      value={securityPin}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '');
                        setSecurityPin(val);
                        if (workerError) setWorkerError('');
                      }}
                      autoFocus
                      className="opacity-0 absolute h-0 w-0"
                    />
                    <div className="grid grid-cols-3 gap-3 mt-6">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'C', 0, 'OK'].map((num) => (
                        <button
                          key={num}
                          onClick={() => {
                            if (num === 'C') setSecurityPin('');
                            else if (num === 'OK') verifySecurityPin();
                            else if (securityPin.length < 6) setSecurityPin(prev => prev + num);
                          }}
                          className="h-14 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-lg transition-colors"
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                    {workerError && (
                      <p className="text-red-500 text-xs font-bold mt-2">{workerError}</p>
                    )}
                    <button 
                      onClick={() => {
                        setWorkerStep('code');
                        setWorkerError('');
                        setSecurityPin('');
                      }}
                      className="w-full py-2 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                    >
                      Change Access Code
                    </button>
                  </>
                )}

                {workerStep === 'code' && (
                  <>
                    <button 
                      onClick={() => setShowLoginModal({ role: 'provider' })}
                      className="w-full py-2 text-zinc-400 hover:text-zinc-200 text-sm font-bold transition-colors"
                    >
                      Login with Name
                    </button>
                    <button 
                      onClick={() => setView('home')}
                      className="w-full py-2 text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
                    >
                      Back to Home
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        ) : !user ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md"
            >
              <h2 className="text-4xl font-bold mb-4">Emergency Roadside Assistance, Simplified.</h2>
              <p className="text-zinc-400 mb-8">Fast, reliable help whenever you're stranded. Join our community of rescuers and those in need.</p>
              <div className="flex flex-col gap-4">
                <button 
                  onClick={() => setShowLoginModal({ role: 'customer' })}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 rounded-xl font-bold text-lg shadow-lg shadow-orange-500/20 transition-all"
                >
                  Get Started
                </button>
              </div>
            </motion.div>
          </div>
        ) : (
          <div className="h-full relative flex flex-col">
            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto bg-zinc-950">
              <div className="max-w-4xl mx-auto h-full">
                {user.role === 'customer' ? (
                  <CustomerView 
                    user={user} 
                    activeRequest={activeRequest} 
                    createRequest={createRequest}
                    updateRequestStatus={updateRequestStatus}
                    setShowChat={setShowChat}
                    submitRating={submitRating}
                    onlineWorkers={onlineWorkers}
                    selectProvider={selectProvider}
                    currentLocation={currentLocation}
                  />
                ) : (
                  <ProviderView 
                    user={user} 
                    activeRequest={activeRequest}
                    updateRequestStatus={updateRequestStatus}
                    setShowChat={setShowChat}
                    currentLocation={currentLocation}
                    toggleOnline={toggleOnline}
                  />
                )}
              </div>
            </div>
            
            {/* Floating SOS Button (Customer only) */}
            {user.role === 'customer' && !activeRequest && (
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowSOSModal(true)}
                className="absolute bottom-20 right-8 w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-2xl shadow-red-600/40 border-4 border-red-500 z-50"
              >
                <span className="text-xl font-black">{t('sos')}</span>
              </motion.button>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="py-3 px-6 bg-zinc-950 border-t border-zinc-900 text-center z-40">
        <p className="text-[10px] text-zinc-600 font-medium tracking-[0.2em] uppercase">
          Powered by <span className="text-orange-500/80 font-bold">A4K</span>
        </p>
      </footer>

      {/* SOS Modal */}
      <AnimatePresence>
        {showSOSModal && (
          <SOSModal onClose={() => setShowSOSModal(false)} />
        )}
      </AnimatePresence>

      {/* Chat Overlay */}
      <AnimatePresence>
        {showChat && activeRequest && (
          <ChatModal 
            messages={messages} 
            onSendMessage={sendMessage} 
            onClose={() => setShowChat(false)} 
            currentUser={user!}
            currentLocation={currentLocation}
          />
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {view === 'profile' && user && (
          <ProfileModal 
            user={user} 
            onClose={() => setView('home')} 
            onLogout={handleLogout} 
          />
        )}
      </AnimatePresence>

      {/* Login Modal */}
      <AnimatePresence>
        {showLoginModal && (
          <LoginModal 
            role={showLoginModal.role}
            onLogin={(name?: string) => {
              handleLogin(showLoginModal.role, showLoginModal.accessCode, showLoginModal.categories, name);
              setShowLoginModal(null);
            }}
            onClose={() => setShowLoginModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function LoginModal({ role, onLogin, onClose }: any) {
  const [name, setName] = useState('');
  const { t } = useTranslation();

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-sm bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-2xl"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">Login</h2>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          <button 
            onClick={() => onLogin()}
            className="w-full py-4 bg-white text-black hover:bg-zinc-200 rounded-xl font-bold flex items-center justify-center gap-3 transition-all"
          >
            <img src="https://www.google.com/favicon.ico" alt="" className="w-5 h-5" />
            Continue with Google
          </button>

          <div className="relative flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-zinc-800"></div>
            </div>
            <span className="relative px-4 bg-zinc-900 text-xs text-zinc-500 uppercase font-bold">Or use your name</span>
          </div>

          <div className="space-y-4">
            <input 
              type="text" 
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500 transition-colors"
            />
            <button 
              onClick={() => name.trim() && onLogin(name)}
              disabled={!name.trim()}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-bold transition-all"
            >
              Continue as Guest
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function RatingSection({ onSubmit }: { onSubmit: (rating: number, review: string) => void }) {
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [hoveredRating, setHoveredRating] = useState(0);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700 space-y-4"
    >
      <div className="text-center">
        <p className="font-bold mb-2">Rate your experience</p>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              onClick={() => setRating(star)}
              className="transition-transform hover:scale-110"
            >
              <Star
                size={32}
                className={cn(
                  "transition-colors",
                  (hoveredRating || rating) >= star ? "text-orange-500 fill-orange-500" : "text-zinc-600"
                )}
              />
            </button>
          ))}
        </div>
      </div>
      <textarea
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder="Share your feedback (optional)"
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm focus:outline-none focus:border-orange-500 transition-colors h-24 resize-none"
      />
      <button
        onClick={() => rating > 0 && onSubmit(rating, review)}
        disabled={rating === 0}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-bold transition-all"
      >
        Submit Rating
      </button>
    </motion.div>
  );
}

function CustomerView({ user, activeRequest, createRequest, updateRequestStatus, setShowChat, submitRating, onlineWorkers, selectProvider, currentLocation }: any) {
  const { t } = useTranslation();
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | null>(null);

  if (activeRequest) {
    return (
      <div className="p-6 flex flex-col h-full">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="px-3 py-1 bg-orange-500/20 text-orange-500 rounded-full text-xs font-bold uppercase tracking-wider">
              {activeRequest.status}
            </span>
            <span className="text-xs text-zinc-500">#{activeRequest.id.slice(-6)}</span>
          </div>
          <h3 className="text-2xl font-bold capitalize">{t(activeRequest.category)}</h3>
          <p className="text-zinc-400 text-sm">{activeRequest.address}</p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1 custom-scrollbar">
          {activeRequest.status === 'pending' ? (
            <div className="space-y-4">
              <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700 flex flex-col items-center text-center">
                <motion.div 
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                  className="w-12 h-12 bg-orange-500/20 rounded-full flex items-center justify-center text-orange-500 mb-3"
                >
                  <CircleDot size={24} />
                </motion.div>
                <p className="font-medium">{t('searching')}</p>
                <p className="text-xs text-zinc-500 mt-1">Found {onlineWorkers.length} rescuers nearby</p>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-zinc-500 uppercase font-bold px-1">Available Rescuers</p>
                {onlineWorkers.length === 0 ? (
                  <div className="p-8 text-center opacity-50">
                    <p className="text-sm italic">Waiting for rescuers to respond...</p>
                  </div>
                ) : (
                  onlineWorkers.map((worker: UserProfile) => {
                    const basePrice = worker.basePrices?.[activeRequest.category] || SERVICE_BASE_PRICES[activeRequest.category];
                    const distance = worker.location ? calculateDistance(
                      currentLocation.lat, currentLocation.lng,
                      worker.location.lat, worker.location.lng
                    ) : 0;
                    const distancePrice = Math.round(distance * DISTANCE_RATE);
                    const totalPrice = basePrice + distancePrice;

                    return (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        key={worker.uid}
                        className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-between group hover:border-orange-500/50 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-full border-2 border-zinc-700 overflow-hidden">
                            <img src={worker.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          <div>
                            <p className="font-bold text-sm">{worker.displayName}</p>
                            <div className="flex items-center gap-1 text-orange-500">
                              <Star size={10} fill="currentColor" />
                              <span className="text-[10px] font-bold">{worker.rating || 4.8}</span>
                              <span className="text-[10px] text-zinc-500 ml-1">({distance.toFixed(1)} km away)</span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-orange-500">₹{totalPrice}</p>
                          <button 
                            onClick={() => selectProvider(worker)}
                            className="mt-1 px-4 py-1.5 bg-orange-500 hover:bg-orange-600 rounded-lg text-[10px] font-bold uppercase transition-all"
                          >
                            Select
                          </button>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-zinc-700 rounded-full overflow-hidden">
                    <UserIcon className="w-full h-full p-2 text-zinc-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold">{activeRequest.providerName || 'Provider'}</p>
                      <span className="text-[10px] px-2 py-0.5 bg-zinc-700 text-zinc-300 rounded-md font-mono">
                        ID: {activeRequest.providerId?.slice(-6).toUpperCase() || 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-orange-500">
                      <Star size={14} fill="currentColor" />
                      <span className="text-xs font-bold">4.8 (120 reviews)</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowChat(true)}
                    className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  >
                    <MessageSquare size={16} /> {t('chat')}
                  </button>
                  <a 
                    href="tel:911" // In real app, use provider's phone number
                    className="flex-1 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  >
                    <Phone size={16} /> {t('call')}
                  </a>
                </div>
              </div>

              <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
                <div className="flex justify-between items-center mb-3">
                  <p className="text-xs text-zinc-500 uppercase font-bold">Price Breakdown</p>
                  <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full border border-green-500/20 font-bold">Kerala Market Rates</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-400">
                      {activeRequest.category === 'fuel' ? 'Fuel Delivery (Base)' : 'Base Service Fee'}
                    </span>
                    <span className="font-medium">₹{activeRequest.basePrice || 500}</span>
                  </div>
                  {activeRequest.category === 'tyre' && (
                    <div className="text-[10px] text-zinc-500 italic -mt-1 mb-1">
                      * Tyre service: ₹200 - ₹400 based on repair type
                    </div>
                  )}
                  {activeRequest.category === 'towing' && (
                    <div className="text-[10px] text-zinc-500 italic -mt-1 mb-1">
                      * Towing service: ₹800 - ₹2,000 based on vehicle type
                    </div>
                  )}
                  {activeRequest.category === 'fuel' && (
                    <div className="text-[10px] text-zinc-500 italic -mt-1 mb-1">
                      * Fuel price: ₹85 - ₹110 per litre (Market rate)
                    </div>
                  )}
                  {activeRequest.category === 'mechanic' && (
                    <div className="text-[10px] text-zinc-500 italic -mt-1 mb-1">
                      * Service range: ₹499 - ₹2,899 based on complexity
                    </div>
                  )}
                  {activeRequest.distance && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Distance Fee ({activeRequest.distance} km)</span>
                      <span className="font-medium">₹{activeRequest.distancePrice || 0}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-zinc-700 flex justify-between font-bold">
                    <div className="flex flex-col">
                      <span>Total Amount</span>
                      <span className="text-[10px] text-zinc-500 font-normal">(Includes all expenses)</span>
                    </div>
                    <span className="text-orange-500">₹{activeRequest.price}</span>
                  </div>
                </div>
              </div>

              {activeRequest.status === 'completed' && !activeRequest.rating && (
                <RatingSection onSubmit={submitRating} />
              )}

              {activeRequest.rating && (
                <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700 text-center">
                  <div className="flex justify-center gap-1 mb-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        size={16}
                        className={star <= activeRequest.rating ? "text-orange-500 fill-orange-500" : "text-zinc-600"}
                      />
                    ))}
                  </div>
                  <p className="text-sm font-bold">Rating Submitted</p>
                  {activeRequest.review && <p className="text-xs text-zinc-500 mt-1 italic">"{activeRequest.review}"</p>}
                </div>
              )}

              {activeRequest.status === 'completed' && activeRequest.paymentStatus === 'pending' && (
                <button 
                  onClick={() => toast.success(t('paymentSuccess'))}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 transition-all"
                >
                  <CreditCard size={20} /> {t('pay')} ₹{activeRequest.price}
                </button>
              )}
            </div>
          )}
        </div>

        <button 
          onClick={() => updateRequestStatus('cancelled')}
          className="mt-auto py-3 text-zinc-500 hover:text-red-500 text-sm font-medium transition-colors"
        >
          Cancel Request
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col h-full">
      <h2 className="text-2xl font-bold mb-6">{t('selectIssue')}</h2>
      <div className="grid grid-cols-2 gap-4">
        {[
          { id: 'tyre', icon: CircleDot, color: 'bg-blue-500' },
          { id: 'towing', icon: Truck, color: 'bg-purple-500' },
          { id: 'fuel', icon: Fuel, color: 'bg-orange-500' },
          { id: 'mechanic', icon: Wrench, color: 'bg-red-500' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => createRequest(cat.id as ServiceCategory)}
            className="p-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl border border-zinc-700 flex flex-col items-center gap-3 transition-all group"
          >
            <div className={cn("p-3 rounded-xl text-white group-hover:scale-110 transition-transform", cat.color)}>
              <cat.icon size={24} />
            </div>
            <span className="text-sm font-bold">{t(cat.id)}</span>
          </button>
        ))}
      </div>
      
      <div className="mt-8 p-4 bg-orange-500/10 rounded-2xl border border-orange-500/20">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-orange-500 rounded-lg text-white">
            <AlertTriangle size={16} />
          </div>
          <p className="font-bold text-orange-500">{t('emergency')}</p>
        </div>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Stranded in a dangerous location? Use the SOS button for immediate priority assistance.
        </p>
      </div>
    </div>
  );
}

function SOSModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  const emergencyServices = [
    { name: t('police'), number: '100', icon: <Shield size={24} />, color: 'bg-blue-600' },
    { name: t('ambulance'), number: '102', icon: <Heart size={24} />, color: 'bg-red-600' },
    { name: t('fireForce'), number: '101', icon: <Flame size={24} />, color: 'bg-orange-600' },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-sm bg-zinc-900 rounded-3xl border border-zinc-800 p-8 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500 rounded-lg text-white">
              <AlertTriangle size={20} />
            </div>
            <h2 className="text-xl font-bold">{t('emergencyCall')}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          {emergencyServices.map((service) => (
            <a 
              key={service.name}
              href={`tel:${service.number}`}
              className="flex items-center justify-between p-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl border border-zinc-700 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 ${service.color} rounded-xl flex items-center justify-center text-white shadow-lg`}>
                  {service.icon}
                </div>
                <div>
                  <p className="font-bold text-lg">{service.name}</p>
                  <p className="text-sm text-zinc-500">{service.number}</p>
                </div>
              </div>
              <div className="p-3 bg-zinc-700 group-hover:bg-orange-500 rounded-full transition-colors">
                <Phone size={20} />
              </div>
            </a>
          ))}
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-8 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-all"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  );
}

function SetPriceModal({ categories, onSave, onClose }: { categories: ServiceCategory[], onSave: (prices: Partial<Record<ServiceCategory, number>>) => void, onClose: () => void }) {
  const [prices, setPrices] = useState<Partial<Record<ServiceCategory, number>>>({});
  const { t } = useTranslation();

  useEffect(() => {
    const initialPrices: Partial<Record<ServiceCategory, number>> = {};
    categories.forEach(cat => {
      initialPrices[cat] = SERVICE_BASE_PRICES[cat];
    });
    setPrices(initialPrices);
  }, [categories]);

  const handlePriceChange = (cat: ServiceCategory, val: string) => {
    const num = parseInt(val) || 0;
    setPrices(prev => ({ ...prev, [cat]: num }));
  };

  const isValid = categories.every(cat => {
    const price = prices[cat] || 0;
    const range = SERVICE_PRICE_RANGES[cat];
    return price >= range.min && price <= range.max;
  });

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="w-full max-w-sm bg-zinc-900 rounded-3xl border border-zinc-800 p-8 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Set Your Prices</h2>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          {categories.map(cat => (
            <div key={cat} className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-bold capitalize">{t(cat)}</label>
                <span className="text-[10px] text-zinc-500">
                  Range: ₹{SERVICE_PRICE_RANGES[cat].min} - ₹{SERVICE_PRICE_RANGES[cat].max}
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">₹</span>
                <input 
                  type="number"
                  value={prices[cat] || ''}
                  onChange={(e) => handlePriceChange(cat, e.target.value)}
                  className={cn(
                    "w-full bg-zinc-800 border rounded-xl pl-8 pr-4 py-3 focus:outline-none transition-colors",
                    (prices[cat] || 0) < SERVICE_PRICE_RANGES[cat].min || (prices[cat] || 0) > SERVICE_PRICE_RANGES[cat].max
                      ? "border-red-500 focus:border-red-500"
                      : "border-zinc-700 focus:border-orange-500"
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        <button 
          onClick={() => isValid && onSave(prices)}
          disabled={!isValid}
          className="w-full mt-8 py-4 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-xl font-bold transition-all"
        >
          Go Online
        </button>
      </motion.div>
    </motion.div>
  );
}

function ProviderView({ user, activeRequest, updateRequestStatus, setShowChat, currentLocation, toggleOnline }: any) {
  const { t } = useTranslation();
  const [showPriceModal, setShowPriceModal] = useState(false);

  const isMaster = user.serviceCategories?.length > 1;
  const dashboardTitle = isMaster 
    ? 'Master Dashboard' 
    : `${t(user.serviceCategories?.[0] || 'worker')} Dashboard`;

  const eta = activeRequest && currentLocation ? calculateETA(
    calculateDistance(
      currentLocation.lat, 
      currentLocation.lng, 
      activeRequest.location.lat, 
      activeRequest.location.lng
    )
  ) : null;

  const handleToggleOnline = () => {
    if (!user.isOnline) {
      setShowPriceModal(true);
    } else {
      toggleOnline();
    }
  };

  if (activeRequest) {
    return (
      <div className="p-6 flex flex-col h-full">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="px-3 py-1 bg-green-500/20 text-green-500 rounded-full text-xs font-bold uppercase tracking-wider">
              Active Job
            </span>
            <span className="text-xs text-zinc-500">#{activeRequest.id.slice(-6)}</span>
          </div>
          <h3 className="text-2xl font-bold capitalize">{t(activeRequest.category)}</h3>
          <p className="text-zinc-400 text-sm">{activeRequest.address}</p>
        </div>

        <div className="space-y-4 flex-1">
          <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
            <p className="text-xs text-zinc-500 uppercase font-bold mb-2">Customer</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-zinc-700 rounded-full overflow-hidden flex items-center justify-center">
                {activeRequest.customerPhoto ? (
                  <img src={activeRequest.customerPhoto} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserIcon size={20} className="text-zinc-400" />
                )}
              </div>
              <div>
                <p className="font-bold">{activeRequest.customerName || 'Customer'}</p>
                <p className="text-xs text-zinc-500">Waiting for your arrival</p>
              </div>
            </div>
          </div>

          <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-zinc-500 uppercase font-bold">Estimated Arrival</p>
              <div className="flex items-center gap-1 text-orange-500">
                <Clock size={14} />
                <span className="text-xs font-bold">{eta} mins</span>
              </div>
            </div>
            <div className="w-full bg-zinc-700 h-1.5 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: '65%' }}
                className="bg-orange-500 h-full"
              />
            </div>
            <p className="text-[10px] text-zinc-500 mt-2 italic">Based on current Kerala traffic data</p>
          </div>

          <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700">
            <div className="flex justify-between items-center mb-3">
              <p className="text-xs text-zinc-500 uppercase font-bold">Price Breakdown</p>
              <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full border border-green-500/20 font-bold">Kerala Market Rates</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Base Service Fee</span>
                <span className="font-medium">₹{activeRequest.basePrice || 500}</span>
              </div>
              {activeRequest.distance && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-400">Distance Fee ({activeRequest.distance} km)</span>
                  <span className="font-medium">₹{activeRequest.distancePrice || 0}</span>
                </div>
              )}
              <div className="pt-2 border-t border-zinc-700 flex justify-between font-bold">
                <div className="flex flex-col">
                  <span>Total Earnings</span>
                  <span className="text-[10px] text-zinc-500 font-normal">(Includes all expenses)</span>
                </div>
                <span className="text-green-500">₹{activeRequest.price}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={() => setShowChat(true)}
              className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-colors"
            >
              <MessageSquare size={18} /> {t('chat')}
            </button>
            <button className="py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl flex items-center justify-center gap-2 text-sm font-bold transition-colors">
              <Phone size={18} /> {t('call')}
            </button>
          </div>

          <button className="w-full py-4 bg-blue-600 hover:bg-blue-700 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all">
            <Navigation size={20} /> {t('navigate')}
          </button>

          {activeRequest.rating && (
            <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700 text-center">
              <p className="text-xs text-zinc-500 uppercase font-bold mb-2">Customer Feedback</p>
              <div className="flex justify-center gap-1 mb-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={16}
                    className={star <= activeRequest.rating ? "text-orange-500 fill-orange-500" : "text-zinc-600"}
                  />
                ))}
              </div>
              {activeRequest.review && <p className="text-xs text-zinc-500 italic">"{activeRequest.review}"</p>}
            </div>
          )}
        </div>

        <div className="mt-auto pt-6 border-t border-zinc-800 space-y-2">
          {activeRequest.status === 'accepted' && (
            <button 
              onClick={() => updateRequestStatus('in-progress')}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 rounded-xl font-bold transition-all"
            >
              Start Service
            </button>
          )}
          {activeRequest.status === 'in-progress' && (
            <button 
              onClick={() => updateRequestStatus('completed')}
              className="w-full py-4 bg-green-600 hover:bg-green-700 rounded-xl font-bold transition-all"
            >
              Complete Service
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 flex flex-col h-full">
      <div className="mb-8">
        <h1 className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-1">
          {isMaster ? 'Administrator Portal' : 'Service Provider Portal'}
        </h1>
        <h2 className="text-2xl font-bold">{dashboardTitle}</h2>
      </div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-zinc-400">{t('requests')}</h3>
        <button 
          onClick={handleToggleOnline}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all duration-300",
            user.isOnline 
              ? "bg-green-500/10 text-green-500 border-green-500/20" 
              : "bg-zinc-800 text-zinc-500 border-zinc-700"
          )}
        >
          <motion.div 
            animate={{ scale: user.isOnline ? [1, 1.2, 1] : 1 }}
            transition={{ duration: 2, repeat: Infinity }}
            className={cn("w-2 h-2 rounded-full", user.isOnline ? "bg-green-500" : "bg-zinc-600")} 
          />
          <span className="text-xs font-bold uppercase">{user.isOnline ? t('online') : 'Offline'}</span>
          <div className={cn(
            "ml-1 w-8 h-4 rounded-full relative transition-colors",
            user.isOnline ? "bg-green-600" : "bg-zinc-700"
          )}>
            <motion.div 
              animate={{ x: user.isOnline ? 16 : 2 }}
              className="absolute top-1 w-2 h-2 bg-white rounded-full shadow-sm"
            />
          </div>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-4">
        <div className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-500",
          user.isOnline ? "bg-green-500/20 text-green-500 animate-pulse" : "bg-zinc-800 text-zinc-600"
        )}>
          {user.isOnline ? <CircleDot size={40} /> : <X size={40} />}
        </div>
        <div>
          <h3 className="text-xl font-bold mb-2">
            {user.isOnline ? "You are Online" : "You are Offline"}
          </h3>
          <p className="text-sm text-zinc-500 max-w-[200px] mx-auto">
            {user.isOnline 
              ? "Waiting for customers to select you for a service." 
              : "Go online to start receiving service requests from customers."}
          </p>
        </div>
        
        {user.isOnline && user.basePrices && (
          <div className="w-full max-w-xs p-4 bg-zinc-800/50 rounded-2xl border border-zinc-700 mt-4">
            <p className="text-xs text-zinc-500 uppercase font-bold mb-3">Your Set Prices</p>
            <div className="space-y-2">
              {Object.entries(user.basePrices).map(([cat, price]) => (
                <div key={cat} className="flex justify-between text-sm">
                  <span className="text-zinc-400 capitalize">{t(cat)}</span>
                  <span className="font-bold">₹{price}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatModal({ messages, onSendMessage, onClose, currentUser, currentLocation }: any) {
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendLocation = () => {
    const locationUrl = `https://www.google.com/maps?q=${currentLocation.lat},${currentLocation.lng}`;
    onSendMessage(locationUrl, 'location');
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[100] flex items-center justify-end p-6 bg-black/40 backdrop-blur-sm pointer-events-none"
    >
      <div className="w-full max-w-[320px] h-[480px] bg-zinc-900 rounded-3xl border border-zinc-800 flex flex-col shadow-2xl overflow-hidden pointer-events-auto">
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center">
              <UserIcon size={20} className="text-zinc-500" />
            </div>
            <div>
              <p className="font-bold">Chat</p>
              <p className="text-xs text-green-500">Active</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {messages.map((msg: any) => (
            <div 
              key={msg.id} 
              className={cn(
                "flex flex-col max-w-[80%]",
                msg.senderId === currentUser.uid ? "ml-auto items-end" : "mr-auto items-start"
              )}
            >
              <span className="text-[10px] text-zinc-500 mb-1 px-1">
                {msg.senderName || 'User'}
              </span>
              <div className={cn(
                "px-4 py-2 rounded-2xl text-sm",
                msg.senderId === currentUser.uid 
                  ? "bg-orange-500 text-white rounded-tr-none" 
                  : "bg-zinc-800 text-zinc-100 rounded-tl-none"
              )}>
                {msg.type === 'location' ? (
                  <a 
                    href={msg.text} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 underline"
                  >
                    <MapPin size={16} /> {t('locationSent')}
                  </a>
                ) : (
                  msg.text
                )}
              </div>
              <span className="text-[10px] text-zinc-600 mt-1">
                {msg.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
          <form 
            onSubmit={(e) => { e.preventDefault(); onSendMessage(text); setText(''); }}
            className="flex gap-2"
          >
            <button 
              type="button"
              onClick={handleSendLocation}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-orange-500 transition-colors"
              title={t('sendLocation')}
            >
              <MapPin size={20} />
            </button>
            <input 
              type="text" 
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-orange-500 transition-colors"
            />
            <button 
              type="submit"
              className="p-2 bg-orange-500 hover:bg-orange-600 rounded-xl text-white transition-colors"
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>
    </motion.div>
  );
}

function ProfileModal({ user, onClose, onLogout }: any) {
  const { t } = useTranslation();
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ServiceRequest[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (showHistory) {
      fetchHistory();
    }
  }, [showHistory]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const q = query(
        collection(db, 'requests'),
        where(user.role === 'customer' ? 'customerId' : 'providerId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      const querySnapshot = await getDocs(q);
      const docs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ServiceRequest));
      setHistory(docs);
    } catch (error) {
      console.error("Error fetching history:", error);
      toast.error("Failed to load service history");
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className="fixed inset-y-0 right-0 w-full max-w-sm z-[100] bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col"
    >
      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {showHistory && (
            <button 
              onClick={() => setShowHistory(false)}
              className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h2 className="text-xl font-bold">{showHistory ? 'Service History' : 'Profile'}</h2>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!showHistory ? (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-24 h-24 rounded-full border-4 border-orange-500 p-1 mb-4">
              <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
            </div>
            <h3 className="text-2xl font-bold">{user.displayName}</h3>
            <p className="text-zinc-500 mb-6">{user.email}</p>
            
            <div className="w-full grid grid-cols-2 gap-4 mb-8">
              <div className="p-4 bg-zinc-800 rounded-2xl border border-zinc-700">
                <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Role</p>
                <p className="font-bold capitalize">{user.role}</p>
              </div>
              <div className="p-4 bg-zinc-800 rounded-2xl border border-zinc-700">
                <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Rating</p>
                <div className="flex items-center justify-center gap-1 text-orange-500">
                  <Star size={14} fill="currentColor" />
                  <span className="font-bold">4.8</span>
                </div>
              </div>
            </div>

            <div className="w-full space-y-2">
              <button className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold flex items-center justify-center gap-3 transition-all">
                <Wallet size={20} /> Payment Methods
              </button>
              <button 
                onClick={() => setShowHistory(true)}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold flex items-center justify-center gap-3 transition-all"
              >
                <CheckCircle2 size={20} /> Service History
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {loadingHistory ? (
              <div className="flex flex-col items-center justify-center py-12 opacity-50">
                <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-sm">Loading history...</p>
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 opacity-50 text-center">
                <CheckCircle2 size={48} className="mb-4 text-zinc-700" />
                <p className="text-sm">No service history found.</p>
              </div>
            ) : (
              history.map((req) => (
                <div 
                  key={req.id}
                  className="p-4 bg-zinc-800 rounded-2xl border border-zinc-700 space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-bold capitalize">{t(req.category)}</p>
                      <p className="text-[10px] text-zinc-500">
                        {req.createdAt?.toDate().toLocaleDateString(undefined, { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      req.status === 'completed' ? "bg-green-500/10 text-green-500" : 
                      req.status === 'cancelled' ? "bg-red-500/10 text-red-500" : 
                      "bg-orange-500/10 text-orange-500"
                    )}>
                      {req.status}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center pt-2 border-t border-zinc-700">
                    <div className="flex items-center gap-2 text-zinc-400">
                      <MapPin size={12} />
                      <span className="text-[10px] line-clamp-1">{req.address}</span>
                    </div>
                    <p className="font-bold text-orange-500">₹{req.price}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-auto p-6 border-t border-zinc-800">
        {!showHistory && (
          <button 
            onClick={onLogout}
            className="w-full py-4 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl font-bold flex items-center justify-center gap-3 transition-all"
          >
            <LogOut size={20} /> Logout
          </button>
        )}
      </div>
    </motion.div>
  );
}
