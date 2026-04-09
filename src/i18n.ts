import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      appName: "Road Sahayi",
      sos: "SOS",
      emergency: "Emergency",
      tyre: "Tyre Repair",
      towing: "Towing",
      fuel: "Fuel Delivery",
      mechanic: "Mechanic Help",
      requesting: "Requesting Help...",
      searching: "Searching for nearby providers...",
      providerFound: "Provider Found!",
      onTheWay: "Provider is on the way",
      arrived: "Provider has arrived",
      completed: "Service Completed",
      pay: "Pay Now",
      rate: "Rate Service",
      chat: "Chat",
      call: "Call",
      loginAsCustomer: "Login as Customer",
      loginAsProvider: "Login as Provider",
      online: "Online",
      offline: "Offline",
      requests: "Requests",
      workerPortal: "Worker Portal",
      accept: "Accept",
      reject: "Reject",
      navigate: "Navigate",
      paymentSuccess: "Payment Successful",
      paymentFailed: "Payment Failed",
      selectIssue: "What's the issue?",
      locationAccess: "Please allow location access to find help nearby.",
      providerAccessCode: "Provider Access Code",
      enterCode: "Enter the private access code to login as a provider",
      invalidCode: "Invalid access code",
      police: "Police",
      ambulance: "Ambulance",
      fireForce: "Fire Force",
      emergencyCall: "Emergency Call",
      callNow: "Call Now",
      sendLocation: "Send Location",
      locationSent: "Location Shared",
    }
  },
  ml: {
    translation: {
      appName: "റോഡ് സഹായി",
      sos: "SOS",
      emergency: "അടിയന്തരം",
      tyre: "ടയർ റിപ്പയർ",
      towing: "ടോവിംഗ്",
      fuel: "ഇന്ധനം",
      mechanic: "മെക്കാനിക്",
      requesting: "സഹായം അഭ്യർത്ഥിക്കുന്നു...",
      searching: "അടുത്തുള്ള സേവനദാതാക്കളെ തിരയുന്നു...",
      providerFound: "സേവനദാതാവിനെ കണ്ടെത്തി!",
      onTheWay: "സേവനദാതാവ് വരുന്നു",
      arrived: "സേവനദാതാവ് എത്തി",
      completed: "സേവനം പൂർത്തിയായി",
      pay: "പണമടയ്ക്കുക",
      rate: "റേറ്റിംഗ് നൽകുക",
      chat: "ചാറ്റ്",
      call: "വിളിക്കുക",
      loginAsCustomer: "കസ്റ്റമർ ആയി ലോഗിൻ ചെയ്യുക",
      loginAsProvider: "സേവനദാതാവായി ലോഗിൻ ചെയ്യുക",
      online: "ഓൺലൈൻ",
      offline: "ഓഫ്‌ലൈൻ",
      requests: "അഭ്യർത്ഥനകൾ",
      workerPortal: "വർക്കർ പോർട്ടൽ",
      accept: "സ്വീകരിക്കുക",
      reject: "നിരസിക്കുക",
      navigate: "നാവിഗേറ്റ് ചെയ്യുക",
      paymentSuccess: "പണമടയ്ക്കൽ വിജയിച്ചു",
      paymentFailed: "പണമടയ്ക്കൽ പരാജയപ്പെട്ടു",
      selectIssue: "എന്താണ് പ്രശ്നം?",
      locationAccess: "അടുത്തുള്ള സഹായം കണ്ടെത്താൻ ലൊക്കേഷൻ അനുവദിക്കുക.",
      providerAccessCode: "പ്രൊവൈഡർ ആക്സസ് കോഡ്",
      enterCode: "സേവനദാതാവായി ലോഗിൻ ചെയ്യാൻ ആക്സസ് കോഡ് നൽകുക",
      invalidCode: "തെറ്റായ ആക്സസ് കോഡ്",
      police: "പോലീസ്",
      ambulance: "ആംബുലൻസ്",
      fireForce: "ഫയർ ഫോഴ്സ്",
      emergencyCall: "അടിയന്തര കോൾ",
      callNow: "വിളിക്കുക",
      sendLocation: "ലൊക്കേഷൻ അയയ്ക്കുക",
      locationSent: "ലൊക്കേഷൻ പങ്കിട്ടു",
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
