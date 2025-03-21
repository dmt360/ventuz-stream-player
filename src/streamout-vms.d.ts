
declare namespace StreamOut {

    type StreamHeader = {
        audioChannels: number,
        audioCodecFourCC: number,
        audioRate: number,
        hdrVersion: number,
        videoCodecFourCC: number,
        videoFrameRateDen: number,
        videoFrameRateNum: number,
        videoWidth: number,
        videoHeight: number,
    }
    
    type FrameHeader = {
        flags: "none" | "keyFrame",
        frameIndex: number,
    }
    
    type StreamPacket =
        { type: "connected", data: StreamHeader } |
        { type: "disconnected" } |
        { type: "error", data: string } |
        { type: "frame", data: FrameHeader };
    
    
    type MouseXYPara = { x: number, y: number };
    
    enum MouseButtonEnum {
        None = 0x00,
        Left = 0x01,
        Right = 0x02,
        Middle = 0x04,
        X1 = 0x08,
        X2 = 0x10,
    };
    
    type TouchPara = { id: number, x: number, y: number };
    
    type Command =
        { type: "mouseMove", data: MouseXYPara } |
        { type: "mouseButtons", data: MouseButtonEnum } |
        { type: "mouseWheel", data: MouseXYPara } |
        { type: "touchBegin", data: TouchPara } |
        { type: "touchMove", data: TouchPara } |
        { type: "touchEnd", data: TouchPara } |
        { type: "touchCancel", data: TouchPara } |
        { type: "char", data: number } |
        { type: "keyDown", data: number } |
        { type: "keyUp", data: number };
    
}