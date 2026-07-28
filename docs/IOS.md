# Wrapping Synthia as a native iOS app

Only needed if you want the physical keyboard working on an iPhone *without*
asking anyone to install a third-party browser. Everything else about the app
already works in Safari.

The web code needs **no changes**. `js/midi/native.js` already implements the
bridge and installs the globals the shell calls into; the app picks the native
transport automatically when `window.SynthiaNative` exists.

## What you need

- A Mac with Xcode
- Node (for Capacitor's CLI)
- An Apple Developer account to install on a device for more than 7 days
  (a free account works, but the build expires weekly and must be re-signed)

## The bridge contract

The shell provides:

```js
window.SynthiaNative = {
  listDevices(): Promise<Array<{ id: string, name: string }>>,
  connect(id: string): Promise<void>,
  disconnect(): Promise<void>,
  showPairingUI?(): Promise<void>,   // CoreMIDI's Bluetooth pairing sheet
}
```

The shell calls, for every incoming message:

```js
window.__synthiaMidi([status, data1, data2])
```

and on any connection change:

```js
window.__synthiaMidiStatus({ status: 'connected' | 'idle' | 'error', name: '…' })
```

Both `__synthia*` globals are installed by the web app, so the shell only has to
call them. That is the entire interface.

## Setting up Capacitor

From the repo root:

```sh
npm init -y
npm install @capacitor/core @capacitor/ios
npx cap init Synthia com.yourname.synthia --web-dir .
npx cap add ios
npx cap sync ios
npx cap open ios
```

`--web-dir .` points Capacitor at the repo root, since there is no build step.
Add `node_modules`, `ios/App/App/public`, and `capacitor.config.json` to
`.gitignore` if you don't want the wrapper committed.

In `ios/App/App/Info.plist`, add the Bluetooth usage string — iOS will terminate
the app without it:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Synthia connects to your Bluetooth MIDI keyboard.</string>
```

To let audio keep playing when the screen locks, also set the background audio
mode and configure the audio session as `.playback` on launch.

## The plugin

Create `ios/App/App/SynthiaMidiPlugin.swift`. This is the whole of it: CoreMIDI
gives you every MIDI source the system knows about, including Bluetooth ones once
they're paired, so the plugin does not need to speak BLE itself.

```swift
import Foundation
import Capacitor
import CoreMIDI
import CoreAudioKit

@objc(SynthiaMidiPlugin)
public class SynthiaMidiPlugin: CAPPlugin {
    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var connected: MIDIEndpointRef?

    override public func load() {
        MIDIClientCreateWithBlock("Synthia" as CFString, &client) { _ in }

        // MIDIDestinationCreateWithProtocol/MIDIInputPortCreateWithProtocol give
        // Universal MIDI Packets; the legacy API hands us plain MIDI 1.0 bytes,
        // which is exactly what the web app wants.
        MIDIInputPortCreateWithBlock(client, "In" as CFString, &inputPort) {
            [weak self] packetList, _ in
            self?.forward(packetList)
        }
    }

    private func forward(_ packetList: UnsafePointer<MIDIPacketList>) {
        for packet in packetList.unsafeSequence() {
            var bytes: [UInt8] = []
            for byte in packet.pointee.bytes() { bytes.append(byte) }
            // Split the packet into individual channel messages.
            var i = 0
            while i < bytes.count {
                let status = bytes[i]
                guard status >= 0x80 else { i += 1; continue }
                let length = Self.messageLength(status)
                let end = min(i + length, bytes.count)
                let message = Array(bytes[i..<end]).map { Int($0) }
                DispatchQueue.main.async {
                    self.bridge?.eval(js: "window.__synthiaMidi(\(message))")
                }
                i += length
            }
        }
    }

    private static func messageLength(_ status: UInt8) -> Int {
        switch status & 0xF0 {
        case 0xC0, 0xD0: return 2
        case 0xF0: return 1
        default: return 3
        }
    }

    @objc func listDevices(_ call: CAPPluginCall) {
        var devices: [[String: String]] = []
        for index in 0..<MIDIGetNumberOfSources() {
            let source = MIDIGetSource(index)
            var name: Unmanaged<CFString>?
            MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &name)
            devices.append([
                "id": String(index),
                "name": name?.takeRetainedValue() as String? ?? "MIDI \(index)",
            ])
        }
        call.resolve(["devices": devices])
    }

    @objc func connect(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let index = Int(id) else {
            call.reject("bad id"); return
        }
        if let previous = connected { MIDIPortDisconnectSource(inputPort, previous) }
        let source = MIDIGetSource(index)
        MIDIPortConnectSource(inputPort, source, nil)
        connected = source

        var name: Unmanaged<CFString>?
        MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &name)
        let deviceName = name?.takeRetainedValue() as String? ?? "MIDI"
        bridge?.eval(js: """
            window.__synthiaMidiStatus({status:'connected',name:'\(deviceName)'})
        """)
        call.resolve()
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let previous = connected { MIDIPortDisconnectSource(inputPort, previous) }
        connected = nil
        bridge?.eval(js: "window.__synthiaMidiStatus({status:'idle',name:''})")
        call.resolve()
    }

    /// The system Bluetooth-MIDI pairing sheet. This is the piece Safari has no
    /// equivalent for, and the reason a wrapper helps at all.
    @objc func showPairingUI(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let controller = CABTMIDICentralViewController()
            let nav = UINavigationController(rootViewController: controller)
            controller.navigationItem.rightBarButtonItem = UIBarButtonItem(
                barButtonSystemItem: .done, target: nil, action: nil)
            self.bridge?.viewController?.present(nav, animated: true)
            call.resolve()
        }
    }
}
```

Register it, and expose it under the name the web app expects, in a small JS
shim loaded before `js/main.js` (or injected by the shell):

```js
import { registerPlugin } from '@capacitor/core';
const plugin = registerPlugin('SynthiaMidiPlugin');
window.SynthiaNative = {
  listDevices: () => plugin.listDevices().then((r) => r.devices),
  connect: (id) => plugin.connect({ id }),
  disconnect: () => plugin.disconnect(),
  showPairingUI: () => plugin.showPairingUI(),
};
```

Also add the Objective-C bridging registration Capacitor requires — a
`SynthiaMidiPlugin.m` declaring the plugin and its four methods — following the
[Capacitor iOS plugin guide](https://capacitorjs.com/docs/plugins/ios).

## Android, if you ever want it

The same shape works with `@capacitor/android` and Android's `MidiManager`:
`MidiManager.getDevices()` to list, `openDevice` plus a `MidiReceiver` to read,
and `openBluetoothDevice` for BLE. It is worth less than on iOS, because the
Android PWA already has two working routes — see
[FEASIBILITY.md](FEASIBILITY.md).

## Testing the bridge without Xcode

The transport is just an interface, so you can drive it from the browser console:

```js
window.SynthiaNative = {
  listDevices: async () => [{ id: '1', name: 'Fake Keyboard' }],
  connect: async () => {},
  disconnect: async () => {},
};
// Reload, connect from the Keyboard sheet, then send a middle C:
window.__synthiaMidi([0x90, 60, 100]);
window.__synthiaMidi([0x80, 60, 0]);
```
