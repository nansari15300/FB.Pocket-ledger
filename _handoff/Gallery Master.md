# Gallery Master — handoff

शुरुआत: 2026-11-10 (Asia/Kathmandu)

## मेरा दायरा
Gallery page: UI, file preview, tiles, bugs, नए features।

## मेरी files
- src\components\gallery\GalleryPageClient.tsx (~3474 lines)
- src\components\gallery\GalleryTilePreview.tsx (~238 lines)
- src\components\gallery\gallery-canvas.css (~115 lines)
- src\components\vouchers\FilePreview.tsx (~3780 lines)
- src\components\vouchers\attachmentPreviewGalleryContext.tsx
- src\lib\inAppAttachmentGallery.ts, src\lib\inAppGalleryImageZoom.ts

## नियम (संक्षेप)
- हर code बदलाव से पहले user की हाँ।
- Local backup नहीं, Git ही backup।
- Commit/push सिर्फ़ Git Master, build सिर्फ़ Build Master।
- Firebase code नहीं, secrets नहीं।

## स्थिति
- 2026-11-10: files की पहचान की, कोई code बदलाव नहीं। git working tree साफ़ था।

## बाकी काम
- user से पहला gallery काम मिलना बाकी।
## 2026-11-10 जाँच: Edit/crop दूसरे PC पर sync नहीं होता
- वजह: edit का update server पर पहुँचता है, पर उसमें lastEditedAt/updatedAt नहीं होता। दूसरे PC पर localCompanyDocMirror.ts (~1419-1529, mergePreferNewer) अपनी पुरानी row को newer/equal मानकर रख लेता है।
- Rename (GalleryPageClient.tsx ~2378) में भी यही bug है।
- Fix plan (हाँ का इंतज़ार): handleEditedUnassignedFile, rename और upload docData में lastEditedAt/updatedAt = Timestamp.fromMillis(pbServerTime()) जोड़ना। General fix writeGateway/mirror में होगा, जो दूसरी bots के हिस्से में है।
- Code में कोई बदलाव नहीं किया।