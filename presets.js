// Public build: demo scene only. Production scenes are imported on the phone from a scene file.
window.PRESETS = [
 {
  "group": "Demo",
  "name": "Demo - every chat feature",
  "order": 9,
  "note": "Test scene: typing, ticks, voice note, photo, actor-typed reply, app call. Delete or copy as you like.",
  "contactName": "Thabo",
  "status": "online",
  "theme": "light",
  "look": "exact",
  "appName": "WhatsApp",
  "startScreen": "chat",
  "lockTime": "10:40",
  "lockDate": "Saturday 3 April",
  "sound": "all",
  "liveTyping": true,
  "unreadBack": 3,
  "lockStack": "",
  "history": "-- Yesterday\n! Messages and calls are end-to-end encrypted.\n> Molo bhuti, are you home? | 18:02 | 3\n< Ewe. See you tomorrow | 18:10\n-- Today",
  "events": [
   {
    "type": "typing",
    "trigger": "tap",
    "delay": 0,
    "seconds": 2.5
   },
   {
    "type": "msg_in",
    "trigger": "auto",
    "delay": 0,
    "text": "Are you on set yet? Call time is 07:00",
    "time": "10:42"
   },
   {
    "type": "msg_out",
    "trigger": "tap",
    "delay": 0,
    "text": "Parking now, 5 min",
    "time": "10:43",
    "ticks": "1",
    "actorTypes": true
   },
   {
    "type": "ticks",
    "trigger": "auto",
    "delay": 1.2,
    "ticks": "2"
   },
   {
    "type": "ticks",
    "trigger": "auto",
    "delay": 2,
    "ticks": "3"
   },
   {
    "type": "voice_in",
    "trigger": "tap",
    "delay": 0,
    "length": "0:14",
    "time": "10:44"
   },
   {
    "type": "call_in",
    "trigger": "tap",
    "delay": 0,
    "name": "Thabo",
    "kind": "app",
    "ringFor": 0
   }
  ]
 }
];
