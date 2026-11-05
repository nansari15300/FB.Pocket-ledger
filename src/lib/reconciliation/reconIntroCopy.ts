/**
 * Share for Reconciling - info (i) popover copy on entity detail pages.
 * Language = app "Intro language" (PlI18n). Hand translations below; any other
 * ISO code falls back to English, which PlGlobalTranslate machine-translates
 * (nodes carry data-pl-intro) exactly like the other intro texts in the app.
 */
export type ReconIntroCopy = {
  title: string;
  share: string;
  link: string;
  recon: string;
  manage: string;
  note: string;
};

const en: ReconIntroCopy = {
  title: "Share for Reconciling",
  share: "Share: send this account's ledger (all transactions or a date range) to another Pocket Ledger user.",
  link: "Link: the other user links your shared ledger to an account in their own company.",
  recon: "Reconciling: once linked, both sides can compare transactions and sync the differences.",
  manage:
    "Change company / Unlink / Request again: the receiver can change the linked company or account, either side can unlink, and after unlinking you can request again to share once more.",
  note: "Works only between Pocket Ledger users (not Inter System). It needs a plan that includes this feature, the company setting turned on, and your role's permission.",
};

const hi: ReconIntroCopy = {
  title: "रिकंसिलिंग के लिए शेयर",
  share: "शेयर: इस खाते का लेजर (सभी लेन-देन या तारीख की सीमा) किसी दूसरे Pocket Ledger यूज़र को भेजें।",
  link: "लिंक: दूसरा यूज़र आपके शेयर किए लेजर को अपनी कंपनी के किसी खाते से जोड़ता है।",
  recon: "रिकंसिलिंग: लिंक होने के बाद दोनों पक्ष लेन-देन का मिलान कर सकते हैं और अंतर सिंक कर सकते हैं।",
  manage:
    "कंपनी बदलें / अनलिंक / फिर से अनुरोध: पाने वाला जुड़ी हुई कंपनी या खाता बदल सकता है, कोई भी पक्ष अनलिंक कर सकता है, और अनलिंक के बाद दोबारा शेयर के लिए फिर से अनुरोध किया जा सकता है।",
  note: "यह सिर्फ Pocket Ledger यूज़र्स के बीच काम करता है (Inter System नहीं)। इसके लिए इस सुविधा वाला प्लान, कंपनी सेटिंग चालू होना और आपकी भूमिका की अनुमति ज़रूरी है।",
};

const ne: ReconIntroCopy = {
  title: "मिलान गर्न सेयर",
  share: "सेयर: यो खाताको लेजर (सबै कारोबार वा मितिको दायरा) अर्को Pocket Ledger प्रयोगकर्तालाई पठाउनुहोस्।",
  link: "लिङ्क: अर्को प्रयोगकर्ताले तपाईंले सेयर गरेको लेजरलाई आफ्नो कम्पनीको कुनै खातासँग जोड्छन्।",
  recon: "मिलान: लिङ्क भएपछि दुवै पक्षले कारोबार तुलना गर्न र फरक सिंक गर्न सक्छन्।",
  manage:
    "कम्पनी बदल्नुहोस् / अनलिङ्क / फेरि अनुरोध: प्राप्तकर्ताले जोडिएको कम्पनी वा खाता बदल्न सक्छ, जुनसुकै पक्षले अनलिङ्क गर्न सक्छ, र अनलिङ्कपछि फेरि सेयर गर्न फेरि अनुरोध गर्न सकिन्छ।",
  note: "यो Pocket Ledger प्रयोगकर्ताहरूबीच मात्र काम गर्छ (Inter System होइन)। यसका लागि यो सुविधा समावेश भएको प्लान, कम्पनी सेटिङ खुला हुनु र तपाईंको भूमिकाको अनुमति चाहिन्छ।",
};

const bn: ReconIntroCopy = {
  title: "রিকনসাইল করার জন্য শেয়ার",
  share: "শেয়ার: এই অ্যাকাউন্টের লেজার (সব লেনদেন বা তারিখের সীমা) অন্য একজন Pocket Ledger ব্যবহারকারীকে পাঠান।",
  link: "লিঙ্ক: অন্য ব্যবহারকারী আপনার শেয়ার করা লেজারটি তাদের নিজের কোম্পানির একটি অ্যাকাউন্টের সাথে যুক্ত করেন।",
  recon: "রিকনসাইলিং: লিঙ্ক হওয়ার পর দুই পক্ষই লেনদেন মিলিয়ে দেখতে এবং পার্থক্য সিঙ্ক করতে পারে।",
  manage:
    "কোম্পানি পরিবর্তন / আনলিঙ্ক / আবার অনুরোধ: গ্রহণকারী লিঙ্ক করা কোম্পানি বা অ্যাকাউন্ট বদলাতে পারেন, যেকোনো পক্ষ আনলিঙ্ক করতে পারে, এবং আনলিঙ্কের পর আবার শেয়ার করতে নতুন করে অনুরোধ করা যায়।",
  note: "এটি শুধু Pocket Ledger ব্যবহারকারীদের মধ্যে কাজ করে (Inter System নয়)। এর জন্য এই সুবিধাসহ প্ল্যান, কোম্পানি সেটিং চালু থাকা এবং আপনার ভূমিকার অনুমতি দরকার।",
};

const gu: ReconIntroCopy = {
  title: "રિકન્સાઇલિંગ માટે શેર",
  share: "શેર: આ ખાતાનું લેજર (બધા વ્યવહારો અથવા તારીખ શ્રેણી) બીજા Pocket Ledger વપરાશકર્તાને મોકલો.",
  link: "લિંક: બીજો વપરાશકર્તા તમારા શેર કરેલા લેજરને પોતાની કંપનીના કોઈ ખાતા સાથે જોડે છે.",
  recon: "રિકન્સાઇલિંગ: લિંક થયા પછી બંને પક્ષ વ્યવહારોની સરખામણી કરી શકે છે અને તફાવત સિંક કરી શકે છે.",
  manage:
    "કંપની બદલો / અનલિંક / ફરી વિનંતી: પ્રાપ્તકર્તા જોડાયેલી કંપની અથવા ખાતું બદલી શકે છે, કોઈપણ પક્ષ અનલિંક કરી શકે છે, અને અનલિંક પછી ફરી શેર કરવા માટે ફરી વિનંતી કરી શકાય છે.",
  note: "આ ફક્ત Pocket Ledger વપરાશકર્તાઓ વચ્ચે કામ કરે છે (Inter System નહીં). તેના માટે આ સુવિધાવાળો પ્લાન, કંપની સેટિંગ ચાલુ હોવી અને તમારી ભૂમિકાની પરવાનગી જરૂરી છે.",
};

const mr: ReconIntroCopy = {
  title: "रिकन्साइल करण्यासाठी शेअर",
  share: "शेअर: या खात्याचे लेजर (सर्व व्यवहार किंवा तारखेची मर्यादा) दुसऱ्या Pocket Ledger वापरकर्त्याला पाठवा.",
  link: "लिंक: दुसरा वापरकर्ता तुम्ही शेअर केलेले लेजर त्याच्या स्वतःच्या कंपनीतील एका खात्याशी जोडतो.",
  recon: "रिकन्साइलिंग: लिंक झाल्यानंतर दोन्ही बाजू व्यवहारांची तुलना करू शकतात आणि फरक सिंक करू शकतात.",
  manage:
    "कंपनी बदला / अनलिंक / पुन्हा विनंती: प्राप्तकर्ता जोडलेली कंपनी किंवा खाते बदलू शकतो, कोणतीही बाजू अनलिंक करू शकते, आणि अनलिंकनंतर पुन्हा शेअर करण्यासाठी पुन्हा विनंती करता येते.",
  note: "हे फक्त Pocket Ledger वापरकर्त्यांमध्येच चालते (Inter System नाही). यासाठी ही सुविधा असलेला प्लॅन, कंपनी सेटिंग चालू असणे आणि तुमच्या भूमिकेची परवानगी आवश्यक आहे.",
};

const ta: ReconIntroCopy = {
  title: "நல்லிணக்கத்திற்கான பகிர்வு",
  share: "பகிர்: இந்தக் கணக்கின் லெட்ஜரை (அனைத்து பரிவர்த்தனைகள் அல்லது தேதி வரம்பு) வேறொரு Pocket Ledger பயனருக்கு அனுப்புங்கள்.",
  link: "இணை: மற்ற பயனர் நீங்கள் பகிர்ந்த லெட்ஜரை தன் சொந்த நிறுவனத்தின் ஒரு கணக்குடன் இணைக்கிறார்.",
  recon: "நல்லிணக்கம்: இணைத்த பிறகு இரு தரப்பும் பரிவர்த்தனைகளை ஒப்பிட்டு வேறுபாடுகளை ஒத்திசைக்கலாம்.",
  manage:
    "நிறுவனத்தை மாற்று / இணைப்பை நீக்கு / மீண்டும் கோரு: பெறுபவர் இணைக்கப்பட்ட நிறுவனம் அல்லது கணக்கை மாற்றலாம், எந்தத் தரப்பும் இணைப்பை நீக்கலாம், நீக்கிய பின் மீண்டும் பகிர மீண்டும் கோரலாம்.",
  note: "இது Pocket Ledger பயனர்களுக்கு இடையே மட்டுமே வேலை செய்யும் (Inter System அல்ல). இந்த வசதி உள்ள திட்டம், நிறுவன அமைப்பு இயக்கத்தில் இருத்தல் மற்றும் உங்கள் பங்கின் அனுமதி தேவை.",
};

const te: ReconIntroCopy = {
  title: "సరిపోల్చడానికి షేర్",
  share: "షేర్: ఈ ఖాతా లెడ్జర్‌ను (అన్ని లావాదేవీలు లేదా తేదీ పరిధి) మరో Pocket Ledger వినియోగదారుకు పంపండి.",
  link: "లింక్: అవతలి వినియోగదారు మీరు షేర్ చేసిన లెడ్జర్‌ను తమ సొంత కంపెనీలోని ఒక ఖాతాకు లింక్ చేస్తారు.",
  recon: "సరిపోల్చడం: లింక్ అయిన తర్వాత ఇరు పక్షాలు లావాదేవీలను పోల్చి తేడాలను సింక్ చేయవచ్చు.",
  manage:
    "కంపెనీ మార్చు / అన్‌లింక్ / మళ్లీ అభ్యర్థించు: స్వీకర్త లింక్ చేసిన కంపెనీ లేదా ఖాతాను మార్చవచ్చు, ఏ పక్షమైనా అన్‌లింక్ చేయవచ్చు, అన్‌లింక్ తర్వాత మళ్లీ షేర్ చేయడానికి మళ్లీ అభ్యర్థించవచ్చు.",
  note: "ఇది Pocket Ledger వినియోగదారుల మధ్య మాత్రమే పనిచేస్తుంది (Inter System కాదు). దీనికి ఈ సదుపాయం ఉన్న ప్లాన్, కంపెనీ సెట్టింగ్ ఆన్‌లో ఉండటం, మీ పాత్ర అనుమతి అవసరం.",
};

const ur: ReconIntroCopy = {
  title: "مصالحت کے لیے شیئر",
  share: "شیئر: اس اکاؤنٹ کا لیجر (تمام لین دین یا تاریخ کی حد) کسی دوسرے Pocket Ledger صارف کو بھیجیں۔",
  link: "لنک: دوسرا صارف آپ کے شیئر کیے گئے لیجر کو اپنی کمپنی کے کسی اکاؤنٹ سے جوڑتا ہے۔",
  recon: "مصالحت: لنک ہونے کے بعد دونوں فریق لین دین کا موازنہ کر سکتے ہیں اور فرق کو سنک کر سکتے ہیں۔",
  manage:
    "کمپنی تبدیل کریں / ان لنک / دوبارہ درخواست: وصول کنندہ جڑی ہوئی کمپنی یا اکاؤنٹ بدل سکتا ہے، کوئی بھی فریق ان لنک کر سکتا ہے، اور ان لنک کے بعد دوبارہ شیئر کرنے کے لیے دوبارہ درخواست کی جا سکتی ہے۔",
  note: "یہ صرف Pocket Ledger صارفین کے درمیان کام کرتا ہے (Inter System نہیں)۔ اس کے لیے اس سہولت والا پلان، کمپنی سیٹنگ آن ہونا اور آپ کے کردار کی اجازت ضروری ہے۔",
};

const ar: ReconIntroCopy = {
  title: "المشاركة للمطابقة",
  share: "مشاركة: أرسل دفتر أستاذ هذا الحساب (كل المعاملات أو نطاق تواريخ) إلى مستخدم آخر في Pocket Ledger.",
  link: "ربط: يربط المستخدم الآخر دفتر الأستاذ الذي شاركته بحساب في شركته.",
  recon: "المطابقة: بعد الربط يمكن للطرفين مقارنة المعاملات ومزامنة الفروقات.",
  manage:
    "تغيير الشركة / إلغاء الربط / طلب مجدد: يمكن للمستلم تغيير الشركة أو الحساب المرتبط، ويمكن لأي طرف إلغاء الربط، وبعد إلغائه يمكن طلب المشاركة مرة أخرى.",
  note: "يعمل فقط بين مستخدمي Pocket Ledger (وليس Inter System). يتطلب خطة تتضمن هذه الميزة، وتفعيل إعداد الشركة، وصلاحية دورك.",
};

const fa: ReconIntroCopy = {
  title: "اشتراک‌گذاری برای تطبیق",
  share: "اشتراک‌گذاری: دفتر کل این حساب (همه تراکنش‌ها یا یک بازه تاریخی) را برای کاربر دیگری از Pocket Ledger بفرستید.",
  link: "اتصال: کاربر دیگر دفتر کل اشتراکی شما را به یکی از حساب‌های شرکت خودش وصل می‌کند.",
  recon: "تطبیق: پس از اتصال، هر دو طرف می‌توانند تراکنش‌ها را مقایسه و تفاوت‌ها را همگام‌سازی کنند.",
  manage:
    "تغییر شرکت / قطع اتصال / درخواست دوباره: گیرنده می‌تواند شرکت یا حساب متصل را تغییر دهد، هر طرف می‌تواند اتصال را قطع کند و پس از قطع اتصال می‌توان دوباره درخواست اشتراک داد.",
  note: "فقط بین کاربران Pocket Ledger کار می‌کند (نه Inter System). به طرحی که این قابلیت را دارد، روشن بودن تنظیم شرکت و مجوز نقش شما نیاز دارد.",
};

const de: ReconIntroCopy = {
  title: "Zum Abgleich teilen",
  share: "Teilen: Senden Sie das Konto-Hauptbuch (alle Buchungen oder einen Zeitraum) an einen anderen Pocket-Ledger-Nutzer.",
  link: "Verknüpfen: Der andere Nutzer verknüpft Ihr geteiltes Hauptbuch mit einem Konto in seinem eigenen Unternehmen.",
  recon: "Abgleich: Nach der Verknüpfung können beide Seiten Buchungen vergleichen und Unterschiede synchronisieren.",
  manage:
    "Unternehmen ändern / Verknüpfung lösen / Erneut anfragen: Der Empfänger kann das verknüpfte Unternehmen oder Konto ändern, jede Seite kann die Verknüpfung lösen, und danach kann erneut zum Teilen angefragt werden.",
  note: "Funktioniert nur zwischen Pocket-Ledger-Nutzern (nicht Inter System). Erforderlich sind ein Tarif mit dieser Funktion, die aktivierte Unternehmenseinstellung und die Berechtigung Ihrer Rolle.",
};

const es: ReconIntroCopy = {
  title: "Compartir para conciliar",
  share: "Compartir: envía el libro mayor de esta cuenta (todas las transacciones o un rango de fechas) a otro usuario de Pocket Ledger.",
  link: "Vincular: el otro usuario vincula tu libro compartido a una cuenta de su propia empresa.",
  recon: "Conciliar: una vez vinculado, ambas partes pueden comparar transacciones y sincronizar las diferencias.",
  manage:
    "Cambiar empresa / Desvincular / Solicitar de nuevo: el receptor puede cambiar la empresa o cuenta vinculada, cualquiera de las partes puede desvincular, y tras desvincular se puede solicitar compartir otra vez.",
  note: "Solo funciona entre usuarios de Pocket Ledger (no Inter System). Requiere un plan con esta función, el ajuste de empresa activado y el permiso de tu rol.",
};

const fr: ReconIntroCopy = {
  title: "Partager pour rapprocher",
  share: "Partager : envoyez le grand livre de ce compte (toutes les opérations ou une période) à un autre utilisateur Pocket Ledger.",
  link: "Lier : l'autre utilisateur relie votre grand livre partagé à un compte de sa propre société.",
  recon: "Rapprochement : une fois lié, les deux parties peuvent comparer les opérations et synchroniser les écarts.",
  manage:
    "Changer de société / Délier / Redemander : le destinataire peut changer la société ou le compte lié, chaque partie peut délier, et après avoir délié on peut redemander le partage.",
  note: "Fonctionne uniquement entre utilisateurs Pocket Ledger (pas Inter System). Nécessite un forfait incluant cette fonction, le paramètre de société activé et l'autorisation de votre rôle.",
};

const it: ReconIntroCopy = {
  title: "Condividi per riconciliare",
  share: "Condividi: invia il libro mastro di questo conto (tutte le transazioni o un intervallo di date) a un altro utente Pocket Ledger.",
  link: "Collega: l'altro utente collega il tuo libro condiviso a un conto della propria azienda.",
  recon: "Riconciliazione: una volta collegato, entrambe le parti possono confrontare le transazioni e sincronizzare le differenze.",
  manage:
    "Cambia azienda / Scollega / Richiedi di nuovo: il destinatario può cambiare l'azienda o il conto collegato, ciascuna parte può scollegare e dopo lo scollegamento si può richiedere di nuovo la condivisione.",
  note: "Funziona solo tra utenti Pocket Ledger (non Inter System). Servono un piano che includa questa funzione, l'impostazione aziendale attiva e il permesso del tuo ruolo.",
};

const pt: ReconIntroCopy = {
  title: "Compartilhar para conciliar",
  share: "Compartilhar: envie o razão desta conta (todas as transações ou um intervalo de datas) para outro usuário do Pocket Ledger.",
  link: "Vincular: o outro usuário vincula seu razão compartilhado a uma conta da própria empresa.",
  recon: "Conciliar: depois de vinculado, os dois lados podem comparar transações e sincronizar as diferenças.",
  manage:
    "Trocar empresa / Desvincular / Solicitar novamente: o destinatário pode trocar a empresa ou conta vinculada, qualquer lado pode desvincular, e depois de desvincular é possível solicitar o compartilhamento de novo.",
  note: "Funciona apenas entre usuários do Pocket Ledger (não Inter System). Requer um plano com este recurso, a configuração da empresa ativada e a permissão do seu perfil.",
};

const ru: ReconIntroCopy = {
  title: "Поделиться для сверки",
  share: "Поделиться: отправьте главную книгу этого счёта (все операции или период) другому пользователю Pocket Ledger.",
  link: "Связать: другой пользователь привязывает вашу общую книгу к счёту в своей компании.",
  recon: "Сверка: после связывания обе стороны могут сравнивать операции и синхронизировать расхождения.",
  manage:
    "Сменить компанию / Отвязать / Запросить снова: получатель может сменить связанную компанию или счёт, любая сторона может отвязать, а после отвязки можно снова запросить доступ.",
  note: "Работает только между пользователями Pocket Ledger (не Inter System). Нужны тариф с этой функцией, включённая настройка компании и разрешение для вашей роли.",
};

const tr: ReconIntroCopy = {
  title: "Mutabakat için paylaş",
  share: "Paylaş: bu hesabın defterini (tüm işlemler veya bir tarih aralığı) başka bir Pocket Ledger kullanıcısına gönderin.",
  link: "Bağla: diğer kullanıcı paylaştığınız defteri kendi şirketindeki bir hesaba bağlar.",
  recon: "Mutabakat: bağlandıktan sonra iki taraf da işlemleri karşılaştırabilir ve farkları eşitleyebilir.",
  manage:
    "Şirketi değiştir / Bağlantıyı kaldır / Tekrar iste: alıcı bağlı şirketi veya hesabı değiştirebilir, her iki taraf bağlantıyı kaldırabilir ve kaldırdıktan sonra yeniden paylaşım istenebilir.",
  note: "Yalnızca Pocket Ledger kullanıcıları arasında çalışır (Inter System değil). Bu özelliği içeren bir plan, açık şirket ayarı ve rolünüzün izni gerekir.",
};

const id: ReconIntroCopy = {
  title: "Bagikan untuk Rekonsiliasi",
  share: "Bagikan: kirim buku besar akun ini (semua transaksi atau rentang tanggal) ke pengguna Pocket Ledger lain.",
  link: "Tautkan: pengguna lain menautkan buku besar yang Anda bagikan ke sebuah akun di perusahaannya sendiri.",
  recon: "Rekonsiliasi: setelah tertaut, kedua pihak dapat membandingkan transaksi dan menyinkronkan selisih.",
  manage:
    "Ganti perusahaan / Putuskan tautan / Minta lagi: penerima dapat mengganti perusahaan atau akun yang tertaut, kedua pihak dapat memutus tautan, dan setelah diputus dapat meminta berbagi lagi.",
  note: "Hanya berfungsi antar pengguna Pocket Ledger (bukan Inter System). Membutuhkan paket yang menyertakan fitur ini, pengaturan perusahaan aktif, dan izin peran Anda.",
};

const vi: ReconIntroCopy = {
  title: "Chia sẻ để đối chiếu",
  share: "Chia sẻ: gửi sổ cái của tài khoản này (tất cả giao dịch hoặc một khoảng ngày) cho người dùng Pocket Ledger khác.",
  link: "Liên kết: người dùng kia liên kết sổ cái bạn đã chia sẻ với một tài khoản trong công ty của họ.",
  recon: "Đối chiếu: sau khi liên kết, hai bên có thể so sánh giao dịch và đồng bộ các chênh lệch.",
  manage:
    "Đổi công ty / Hủy liên kết / Yêu cầu lại: bên nhận có thể đổi công ty hoặc tài khoản đã liên kết, mỗi bên đều có thể hủy liên kết, và sau khi hủy có thể yêu cầu chia sẻ lại.",
  note: "Chỉ hoạt động giữa người dùng Pocket Ledger (không phải Inter System). Cần gói có tính năng này, bật cài đặt công ty và quyền theo vai trò của bạn.",
};

const ja: ReconIntroCopy = {
  title: "照合のために共有",
  share: "共有: このアカウントの元帳（全取引または期間指定）を別の Pocket Ledger ユーザーに送ります。",
  link: "リンク: 相手ユーザーが、共有された元帳を自社のアカウントに紐付けます。",
  recon: "照合: リンク後は、双方が取引を比較し、差異を同期できます。",
  manage:
    "会社の変更 / リンク解除 / 再リクエスト: 受信者はリンク先の会社やアカウントを変更でき、どちらの側もリンクを解除でき、解除後は再度共有をリクエストできます。",
  note: "Pocket Ledger ユーザー間でのみ利用できます（Inter System は対象外）。この機能を含むプラン、会社設定の有効化、ロールの権限が必要です。",
};

const ko: ReconIntroCopy = {
  title: "대사를 위한 공유",
  share: "공유: 이 계정의 원장(전체 거래 또는 기간)을 다른 Pocket Ledger 사용자에게 보냅니다.",
  link: "연결: 상대 사용자가 공유받은 원장을 자신의 회사 계정에 연결합니다.",
  recon: "대사: 연결되면 양쪽 모두 거래를 비교하고 차이를 동기화할 수 있습니다.",
  manage:
    "회사 변경 / 연결 해제 / 다시 요청: 수신자는 연결된 회사나 계정을 바꿀 수 있고, 어느 쪽이든 연결을 해제할 수 있으며, 해제 후에는 다시 공유를 요청할 수 있습니다.",
  note: "Pocket Ledger 사용자 간에만 작동합니다(Inter System 제외). 이 기능이 포함된 요금제, 회사 설정 켜기, 역할 권한이 필요합니다.",
};

const zh: ReconIntroCopy = {
  title: "共享用于对账",
  share: "共享：将此账户的分类账（全部交易或某个日期范围）发送给另一位 Pocket Ledger 用户。",
  link: "关联：对方用户把你共享的分类账关联到其自己公司中的某个账户。",
  recon: "对账：关联后，双方可以比较交易并同步差异。",
  manage:
    "更换公司 / 取消关联 / 再次请求：接收方可以更换已关联的公司或账户，任何一方都可以取消关联，取消后可以再次请求共享。",
  note: "仅适用于 Pocket Ledger 用户之间（不含 Inter System）。需要包含此功能的套餐、已开启的公司设置以及你的角色权限。",
};

export const RECON_INTRO_COPY: Record<string, ReconIntroCopy> = {
  en, hi, ne, bn, gu, mr, ta, te, ur, ar, fa, de, es, fr, it, pt, ru, tr, id, vi, ja, ko, zh,
};

/** Languages with a hand translation (all others fall back to English + auto-translate). */
export const RECON_INTRO_HAND_LANGS = Object.keys(RECON_INTRO_COPY);

export function pickReconIntro(introLang: string): ReconIntroCopy {
  return RECON_INTRO_COPY[introLang] ?? en;
}