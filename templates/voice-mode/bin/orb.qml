// The voice mode orb, run by Qt 6's `qml` tool: qml orb.qml -- <state url>.
// Two layer-shell surfaces in the overlay layer, above every window: the orb itself, which
// never takes a click (clicks go to whatever is under it), and a small pill under it that
// drags the orb and ends the conversation. It polls the voice mode process for a mode
// (idle, listening, thinking, speaking) and a 0..1 audio level, and animates from those.

import QtQuick
import QtQuick.Window
import QtQuick.Shapes
import org.kde.layershell as LayerShell

Window {
    id: orb

    readonly property string base: {
        const a = Qt.application.arguments;
        const i = a.indexOf("--");
        return i >= 0 && i + 1 < a.length ? a[i + 1] : "";
    }
    property var look: null
    property string mode: "thinking"
    property real target: 0
    property real level: 0
    property real t: 0
    property int misses: 0

    // Placement: margins from the configured corner; the pill sits under (or over) the orb.
    property int size: 150
    property int mx: 40
    property int my: 40
    readonly property bool top: look !== null && look.corner.indexOf("top") === 0
    readonly property bool left: look !== null && look.corner.indexOf("left") > 0
    readonly property int pillW: 66
    readonly property int pillH: 22
    readonly property int gap: 2

    // How much of each look shows; animated so one look melts into the next.
    property real idleAmt: mode === "idle" ? 1 : 0
    property real listenAmt: mode === "listening" ? 1 : 0
    property real thinkAmt: mode === "thinking" ? 1 : 0
    property real speakAmt: mode === "speaking" ? 1 : 0
    Behavior on idleAmt { NumberAnimation { duration: 350; easing.type: Easing.InOutQuad } }
    Behavior on listenAmt { NumberAnimation { duration: 250; easing.type: Easing.InOutQuad } }
    Behavior on thinkAmt { NumberAnimation { duration: 350; easing.type: Easing.InOutQuad } }
    Behavior on speakAmt { NumberAnimation { duration: 250; easing.type: Easing.InOutQuad } }

    function colorFor(m) {
        return look && look.colors && look.colors[m] ? look.colors[m] : "#38bdf8";
    }
    property color tint: colorFor(mode)
    Behavior on tint { ColorAnimation { duration: 350 } }

    width: size
    height: size
    color: "transparent"
    visible: false
    title: "Voice mode"
    flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowTransparentForInput | Qt.WindowDoesNotAcceptFocus | Qt.Tool

    LayerShell.Window.scope: "voice-mode-orb"
    LayerShell.Window.layer: LayerShell.Window.LayerOverlay
    LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
    LayerShell.Window.exclusionZone: 0
    LayerShell.Window.anchors: (top ? LayerShell.Window.AnchorTop : LayerShell.Window.AnchorBottom) | (left ? LayerShell.Window.AnchorLeft : LayerShell.Window.AnchorRight)
    LayerShell.Window.margins.left: left ? mx : 0
    LayerShell.Window.margins.right: left ? 0 : mx
    LayerShell.Window.margins.top: top ? my : 0
    LayerShell.Window.margins.bottom: top ? 0 : my + pillH + gap

    function request(method, route, body, done) {
        const x = new XMLHttpRequest();
        x.onreadystatechange = function () {
            if (x.readyState !== XMLHttpRequest.DONE) return;
            if (done) done(x.status === 200 ? JSON.parse(x.responseText) : null);
        };
        x.open(method, base + "/" + route);
        x.send(body ? JSON.stringify(body) : null);
    }

    Component.onCompleted: {
        if (!base) Qt.quit();
        request("GET", "look", null, function (l) {
            if (!l) return Qt.quit();
            look = l;
            size = l.size;
            mx = l.x;
            my = l.y;
            orb.visible = true;
            pill.visible = true;
        });
    }

    // State: a small JSON poll, 20 times a second, from the local voice mode process.
    Timer {
        interval: 50
        running: orb.look !== null
        repeat: true
        onTriggered: orb.request("GET", "state", null, function (s) {
            if (!s) {
                if (++orb.misses > 20) Qt.quit(); // the conversation has ended
                return;
            }
            orb.misses = 0;
            orb.mode = s.mode;
            orb.target = s.level;
        })
    }

    FrameAnimation {
        running: orb.visible
        onTriggered: {
            orb.t += frameTime;
            // Rise fast, fall slowly, like a level meter.
            orb.level += (orb.target - orb.level) * (orb.target > orb.level ? 0.45 : 0.12);
        }
    }

    Item {
        id: face
        anchors.fill: parent
        readonly property real c: width / 2
        readonly property real r0: width * 0.3
        readonly property real maxLen: width * 0.17
        readonly property real breath: Math.sin(orb.t * 1.7)

        // A faint dark disc, so the orb reads on a light page as well as a dark one.
        Rectangle {
            width: face.width * 0.94
            height: width
            radius: width / 2
            anchors.centerIn: parent
            color: "#0b1220"
            opacity: 0.28
        }

        // Soft glow behind everything, swelling with the level.
        Repeater {
            model: 3
            Rectangle {
                required property int index
                readonly property real d: face.width * (0.5 + index * 0.13) * (1 + 0.1 * face.breath * orb.idleAmt + 0.22 * orb.level * (orb.listenAmt + orb.speakAmt))
                width: d
                height: d
                radius: d / 2
                x: face.c - d / 2
                y: face.c - d / 2
                color: orb.tint
                opacity: (0.16 - index * 0.045) * (0.7 + 0.6 * orb.level)
            }
        }

        // The ring of bars: a slow breath when idle, a smooth wave with the user's voice,
        // a lively spectrum with the reply, and a sweeping highlight while thinking.
        Repeater {
            model: 56
            Item {
                id: bar
                required property int index
                readonly property real a: index / 56
                readonly property real wl: 0.5 + 0.5 * Math.sin(index * 0.45 + orb.t * 5)
                readonly property real ws: Math.abs(Math.sin(index * 1.9 + orb.t * 11)) * (0.55 + 0.45 * Math.sin(index * 0.37 - orb.t * 3.2))
                readonly property real sweep: {
                    let d = Math.abs(((a - orb.t * 0.55) % 1 + 1) % 1 - 0.5);
                    return Math.exp(-Math.pow((0.5 - d) * 9, 2));
                }
                readonly property real amount: orb.idleAmt * (0.12 + 0.06 * Math.sin(orb.t * 1.7 + index * 0.22))
                    + orb.listenAmt * (0.1 + orb.level * (0.25 + 0.75 * wl))
                    + orb.speakAmt * (0.1 + orb.level * (0.2 + 0.8 * ws))
                    + orb.thinkAmt * (0.08 + 0.5 * sweep)
                anchors.fill: parent
                rotation: a * 360
                Rectangle {
                    readonly property real len: 2 + face.maxLen * Math.min(1, bar.amount)
                    width: 3
                    height: len
                    radius: 1.5
                    x: face.c - 1.5
                    y: face.c - face.r0 - len
                    color: orb.tint
                    opacity: 0.45 + 0.55 * Math.min(1, bar.amount * 1.6)
                }
            }
        }

        // Thinking: two arcs turning in opposite directions.
        Shape {
            anchors.fill: parent
            opacity: orb.thinkAmt
            visible: opacity > 0.01
            preferredRendererType: Shape.CurveRenderer
            ShapePath {
                strokeColor: orb.tint
                strokeWidth: 2.5
                fillColor: "transparent"
                capStyle: ShapePath.RoundCap
                PathAngleArc { centerX: face.c; centerY: face.c; radiusX: face.r0 * 0.82; radiusY: radiusX; startAngle: orb.t * 200; sweepAngle: 80 }
            }
            ShapePath {
                strokeColor: orb.tint
                strokeWidth: 2.5
                fillColor: "transparent"
                capStyle: ShapePath.RoundCap
                PathAngleArc { centerX: face.c; centerY: face.c; radiusX: face.r0 * 0.82; radiusY: radiusX; startAngle: 180 - orb.t * 150; sweepAngle: 60 }
            }
        }

        // A fine ring around the core.
        Rectangle {
            readonly property real d: face.r0 * 1.84
            width: d
            height: d
            radius: d / 2
            x: face.c - d / 2
            y: face.c - d / 2
            color: "transparent"
            border.width: 1.2
            border.color: orb.tint
            opacity: 0.55
        }

        // The core: a glowing sphere that pulses with the voice, brightest while speaking.
        Shape {
            id: core
            readonly property real r: face.r0 * (0.62 + 0.04 * face.breath + 0.28 * orb.level * (orb.listenAmt + orb.speakAmt) + 0.06 * orb.thinkAmt * Math.sin(orb.t * 4))
            anchors.fill: parent
            preferredRendererType: Shape.CurveRenderer
            ShapePath {
                strokeColor: "transparent"
                fillGradient: RadialGradient {
                    centerX: face.c - core.r * 0.25
                    centerY: face.c - core.r * 0.3
                    centerRadius: core.r * 1.25
                    focalX: centerX
                    focalY: centerY
                    GradientStop { position: 0; color: Qt.lighter(orb.tint, 1.7) }
                    GradientStop { position: 0.45; color: orb.tint }
                    GradientStop { position: 1; color: Qt.darker(orb.tint, 2.4) }
                }
                PathAngleArc { centerX: face.c; centerY: face.c; radiusX: core.r; radiusY: core.r; startAngle: 0; sweepAngle: 360 }
            }
        }
    }

    // The pill: the only part that takes the mouse. Drag the dots to move the orb; the
    // cross ends the conversation.
    Window {
        id: pill
        transientParent: null // a surface of its own, not a popup of the orb
        width: orb.pillW
        height: orb.pillH
        color: "transparent"
        visible: false
        title: "Voice mode controls"
        flags: Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.WindowDoesNotAcceptFocus | Qt.Tool

        LayerShell.Window.scope: "voice-mode-orb-controls"
        LayerShell.Window.layer: LayerShell.Window.LayerOverlay
        LayerShell.Window.keyboardInteractivity: LayerShell.Window.KeyboardInteractivityNone
        LayerShell.Window.exclusionZone: 0
        LayerShell.Window.anchors: (orb.top ? LayerShell.Window.AnchorTop : LayerShell.Window.AnchorBottom) | (orb.left ? LayerShell.Window.AnchorLeft : LayerShell.Window.AnchorRight)
        LayerShell.Window.margins.left: orb.left ? orb.mx + (orb.size - width) / 2 : 0
        LayerShell.Window.margins.right: orb.left ? 0 : orb.mx + (orb.size - width) / 2
        LayerShell.Window.margins.top: orb.top ? orb.my + orb.size + orb.gap : 0
        LayerShell.Window.margins.bottom: orb.top ? 0 : orb.my

        Rectangle {
            anchors.fill: parent
            radius: height / 2
            color: "#d90f172a"
            border.width: 1
            border.color: Qt.rgba(orb.tint.r, orb.tint.g, orb.tint.b, 0.6)

            MouseArea {
                id: grip
                width: parent.width - 24
                height: parent.height
                cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
                property real px: 0
                property real py: 0
                onPressed: (m) => { px = m.x; py = m.y; }
                onPositionChanged: (m) => {
                    // The surface follows the pointer, so each move is measured from the press point.
                    const dx = m.x - px, dy = m.y - py;
                    const sw = Screen.width, sh = Screen.height;
                    orb.mx = Math.max(0, Math.min(sw - orb.size, orb.mx + (orb.left ? dx : -dx)));
                    orb.my = Math.max(0, Math.min(sh - orb.size - orb.pillH, orb.my + (orb.top ? dy : -dy)));
                }
                onReleased: orb.request("POST", "moved", { x: orb.mx, y: orb.my })
                Grid {
                    anchors.centerIn: parent
                    columns: 4
                    spacing: 3
                    Repeater {
                        model: 8
                        Rectangle { width: 3; height: 3; radius: 1.5; color: "#cbd5e1"; opacity: grip.containsMouse || grip.pressed ? 1 : 0.7 }
                    }
                }
                hoverEnabled: true
            }

            MouseArea {
                id: close
                anchors.right: parent.right
                width: 24
                height: parent.height
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    orb.request("POST", "stop", {}, null);
                    orb.visible = false;
                    pill.visible = false;
                }
                Rectangle {
                    anchors.centerIn: parent
                    width: 16
                    height: 16
                    radius: 8
                    color: close.containsMouse ? "#ef4444" : "transparent"
                }
                Text {
                    anchors.centerIn: parent
                    text: "×"
                    color: "#f1f5f9"
                    font.pixelSize: 15
                }
            }
        }
    }
}
