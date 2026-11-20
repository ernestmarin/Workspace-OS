/** Voice-module-only strings for local dictation. This is not global app i18n. */
export const SUPPORTED_VOICE_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ar', name: 'العربية' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'he', name: 'עברית' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
] as const

export type VoiceLanguage = (typeof SUPPORTED_VOICE_LANGUAGES)[number]['code']

export const isRtlVoiceLanguage = (language: string): boolean => language === 'ar' || language === 'he'

export interface DictationText {
  dictate: string
  stop: string
  cancel: string
  requesting: string
  transcribing: string
  autoStop: string
  autoStopTitle: string
  language: string
  dictateTitle: string
}

const TEXT: Record<VoiceLanguage, DictationText> = {
  en: { dictate: 'Dictate locally (experimental)', stop: 'Stop recording', cancel: 'Cancel', requesting: 'Requesting microphone…', transcribing: 'Transcribing locally…', autoStop: 'Auto-stop on silence', autoStopTitle: 'Experimental energy-based silence detection may end early in noisy environments.', language: 'Language', dictateTitle: 'Record up to 30 seconds for local transcription in {language}; review before sending' },
  ar: { dictate: 'إملاء محلي (تجريبي)', stop: 'إيقاف التسجيل', cancel: 'إلغاء', requesting: 'طلب الميكروفون…', transcribing: 'جارٍ النسخ محليًا…', autoStop: 'إيقاف تلقائي عند الصمت', autoStopTitle: 'قد ينهي كشف الصمت التجريبي القائم على الطاقة التسجيل مبكرًا في البيئات الصاخبة.', language: 'اللغة', dictateTitle: 'سجّل حتى 30 ثانية للنسخ المحلي بـ{language}؛ راجع قبل الإرسال' },
  de: { dictate: 'Lokal diktieren (experimentell)', stop: 'Aufnahme stoppen', cancel: 'Abbrechen', requesting: 'Mikrofon wird angefordert…', transcribing: 'Lokal transkribieren…', autoStop: 'Automatisch bei Stille stoppen', autoStopTitle: 'Die experimentelle energiebasierte Stilleerkennung kann in lauten Umgebungen zu früh enden.', language: 'Sprache', dictateTitle: 'Bis zu 30 Sekunden für lokale Transkription in {language} aufnehmen; vor dem Senden prüfen' },
  es: { dictate: 'Dictar localmente (experimental)', stop: 'Detener grabación', cancel: 'Cancelar', requesting: 'Solicitando micrófono…', transcribing: 'Transcribiendo localmente…', autoStop: 'Detener automáticamente al detectar silencio', autoStopTitle: 'La detección experimental de silencio por energía puede terminar pronto en entornos ruidosos.', language: 'Idioma', dictateTitle: 'Grabar hasta 30 segundos para transcripción local en {language}; revisa antes de enviar' },
  fr: { dictate: 'Dicter localement (expérimental)', stop: 'Arrêter l’enregistrement', cancel: 'Annuler', requesting: 'Demande du microphone…', transcribing: 'Transcription locale…', autoStop: 'Arrêt automatique en cas de silence', autoStopTitle: 'La détection expérimentale du silence par énergie peut s’arrêter trop tôt dans les environnements bruyants.', language: 'Langue', dictateTitle: 'Enregistrer jusqu’à 30 secondes pour une transcription locale en {language} ; vérifier avant l’envoi' },
  he: { dictate: 'הכתבה מקומית (ניסיוני)', stop: 'עצירת ההקלטה', cancel: 'ביטול', requesting: 'מבקש מיקרופון…', transcribing: 'מתמלל מקומית…', autoStop: 'עצירה אוטומטית בשקט', autoStopTitle: 'זיהוי שקט ניסיוני מבוסס אנרגיה עלול להסתיים מוקדם בסביבות רועשות.', language: 'שפה', dictateTitle: 'הקלט עד 30 שניות לתמלול מקומי ב{language}; בדוק לפני שליחה' },
  hi: { dictate: 'स्थानीय रूप से डिक्टेट करें (प्रायोगिक)', stop: 'रिकॉर्डिंग रोकें', cancel: 'रद्द करें', requesting: 'माइक्रोफ़ोन मांगा जा रहा है…', transcribing: 'स्थानीय रूप से ट्रांसक्राइब हो रहा है…', autoStop: 'चुप्पी पर स्वतः रोकें', autoStopTitle: 'प्रायोगिक ऊर्जा-आधारित चुप्पी पहचान शोर वाले वातावरण में जल्दी समाप्त हो सकती है।', language: 'भाषा', dictateTitle: 'स्थानीय ट्रांसक्रिप्शन के लिए {language} में 30 सेकंड तक रिकॉर्ड करें; भेजने से पहले समीक्षा करें' },
  ru: { dictate: 'Локальная диктовка (экспериментально)', stop: 'Остановить запись', cancel: 'Отмена', requesting: 'Запрос микрофона…', transcribing: 'Локальная транскрибация…', autoStop: 'Автоматическая остановка при тишине', autoStopTitle: 'Экспериментальное определение тишины по энергии может завершиться раньше в шумной обстановке.', language: 'Язык', dictateTitle: 'Запишите до 30 секунд для локальной транскрибации на языке {language}; проверьте перед отправкой' },
  zh: { dictate: '本地听写（实验性）', stop: '停止录音', cancel: '取消', requesting: '正在请求麦克风…', transcribing: '正在本地转录…', autoStop: '静音时自动停止', autoStopTitle: '实验性能量静音检测在嘈杂环境中可能提前结束。', language: '语言', dictateTitle: '使用{language}录制最多 30 秒进行本地转录；发送前请检查' },
}

export function dictationText(language: VoiceLanguage): DictationText {
  return TEXT[language] ?? TEXT.en
}

export function voiceLanguageName(language: VoiceLanguage): string {
  return SUPPORTED_VOICE_LANGUAGES.find((entry) => entry.code === language)?.name ?? language
}

/** Device selection labels kept in the voice module. Device names are OS metadata. */
const DEVICE_TEXT: Record<VoiceLanguage, { microphone: string; systemDefault: string; refresh: string; unnamed: string; unavailable: string }> = {
  en: { microphone: 'Microphone', systemDefault: 'System default', refresh: 'Refresh microphones', unnamed: 'Microphone {number}', unavailable: 'Selected microphone (not listed)' },
  ar: { microphone: 'الميكروفون', systemDefault: 'افتراضي النظام', refresh: 'تحديث الميكروفونات', unnamed: 'ميكروفون {number}', unavailable: 'الميكروفون المحدد (غير مدرج)' },
  de: { microphone: 'Mikrofon', systemDefault: 'Systemstandard', refresh: 'Mikrofone aktualisieren', unnamed: 'Mikrofon {number}', unavailable: 'Ausgewähltes Mikrofon (nicht aufgeführt)' },
  es: { microphone: 'Micrófono', systemDefault: 'Predeterminado del sistema', refresh: 'Actualizar micrófonos', unnamed: 'Micrófono {number}', unavailable: 'Micrófono seleccionado (no listado)' },
  fr: { microphone: 'Microphone', systemDefault: 'Par défaut du système', refresh: 'Actualiser les microphones', unnamed: 'Microphone {number}', unavailable: 'Microphone sélectionné (non répertorié)' },
  he: { microphone: 'מיקרופון', systemDefault: 'ברירת המחדל של המערכת', refresh: 'רענון מיקרופונים', unnamed: 'מיקרופון {number}', unavailable: 'המיקרופון שנבחר (לא ברשימה)' },
  hi: { microphone: 'माइक्रोफ़ोन', systemDefault: 'सिस्टम डिफ़ॉल्ट', refresh: 'माइक्रोफ़ोन रीफ़्रेश करें', unnamed: 'माइक्रोफ़ोन {number}', unavailable: 'चयनित माइक्रोफ़ोन (सूची में नहीं)' },
  ru: { microphone: 'Микрофон', systemDefault: 'Системный по умолчанию', refresh: 'Обновить микрофоны', unnamed: 'Микрофон {number}', unavailable: 'Выбранный микрофон (не в списке)' },
  zh: { microphone: '麦克风', systemDefault: '系统默认', refresh: '刷新麦克风', unnamed: '麦克风 {number}', unavailable: '所选麦克风（未列出）' },
}
export const dictationDeviceText = (language: VoiceLanguage): (typeof DEVICE_TEXT)[VoiceLanguage] => DEVICE_TEXT[language] ?? DEVICE_TEXT.en
