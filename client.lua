local args = {...}

local ws = assert(http.websocket("67.213.108.79:2000"))
local song = args[1]
local dfpwm = require("cc.audio.dfpwm")
local speaker = peripheral.find("speaker")
local decoder = dfpwm.make_decoder()

local function send (d)
    local data = textutils.serializeJSON(d)
    ws.send(data)
end

while true do
    local ok, data, binary = pcall(ws.receive)
    if not ok then
        print("Disconnected from the server.")
        break
    end
    if not binary then
        local ok, msg = pcall(textutils.unserializeJSON, data)
        if not ok then
            print("Failed to parse message from server.")
            break
        end
        if msg.error == true then
            error("Error from server: " .. msg.code)
        end
        if msg.intent == "hello" then
            send({
                intent = "beginSession",
                song = song
            })        
        elseif msg.intent == "status" then
            print("Message from server: " .. msg.status)
        end
    else
        local chunk = data
        local buffer = decoder(chunk)
        while not speaker.playAudio(buffer) do
            os.pullEvent("speaker_audio_empty")
        end
        send({
            intent = "next"
        })
    end
end