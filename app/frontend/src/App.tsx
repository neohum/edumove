import {useEffect, useRef, useState} from 'react';
import './App.css';
import {FilesetResolver, PoseLandmarker} from '@mediapipe/tasks-vision';
import {EventsEmit} from '../wailsjs/runtime/runtime';
import {Toaster, toast} from 'sonner';

type CamState = 'idle' | 'requesting' | 'live' | 'error';
type ExerciseId = 'squat' | 'arm_raise';
type DetectionStage = 'standing' | 'bending' | 'holding' | 'success';

interface ExerciseJoint {
    name: string;
    jointA: number;
    jointB: number; // Center joint where angle is calculated
    jointC: number;
    target: number;
    tolerance: number;
    isLessThan: boolean; // True if angle should be less than target, false if greater
}

interface Exercise {
    id: ExerciseId;
    name: string;
    description: string;
    joints: ExerciseJoint[];
    holdMs: number;
}

const EXERCISES: Exercise[] = [
    {
        id: 'squat',
        name: '스쿼트',
        description: '엉덩이를 낮추어 무릎을 약 90도 부근까지 굽히고 버티세요.',
        holdMs: 800,
        joints: [
            { name: '왼쪽 무릎', jointA: 23, jointB: 25, jointC: 27, target: 105, tolerance: 15, isLessThan: true },
            { name: '오른쪽 무릎', jointA: 24, jointB: 26, jointC: 28, target: 105, tolerance: 15, isLessThan: true }
        ]
    },
    {
        id: 'arm_raise',
        name: '만세 동작',
        description: '양팔을 머리 위로 똑바로 들어 올리고 버티세요.',
        holdMs: 800,
        joints: [
            { name: '왼쪽 어깨', jointA: 23, jointB: 11, jointC: 13, target: 145, tolerance: 20, isLessThan: false },
            { name: '오른쪽 어깨', jointA: 24, jointB: 12, jointC: 14, target: 145, tolerance: 20, isLessThan: false }
        ]
    }
];

// Helper to calculate angle between three keypoints (a - b - c) at vertex b
function calculateAngle(a: any, b: any, c: any): number {
    if (!a || !b || !c) return 0;
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180.0) {
        angle = 360.0 - angle;
    }
    return angle;
}

// Play a success sound utilizing Web Audio API (completely offline)
function playSuccessBeep() {
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Tone 1
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.12);
        osc1.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.12);

        // Tone 2 (delayed and higher)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.08); // E5
        gain2.gain.setValueAtTime(0.08, audioCtx.currentTime + 0.08);
        gain2.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.22);
        osc2.start(audioCtx.currentTime + 0.08);
        osc2.stop(audioCtx.currentTime + 0.22);
    } catch (err) {
        console.error('Audio Context failure:', err);
    }
}

// Play a countdown beep utilizing Web Audio API (A4 for tick, A5 for start)
function playCountdownBeep(isStart: boolean) {
    try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        if (isStart) {
            osc.frequency.setValueAtTime(880.00, audioCtx.currentTime); // A5 (high)
            gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.3);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.3);
        } else {
            osc.frequency.setValueAtTime(440.00, audioCtx.currentTime); // A4 (low)
            gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.15);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.15);
        }
    } catch (err) {
        console.error('Countdown audio error:', err);
    }
}

function App() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const landmarkerRef = useRef<PoseLandmarker | null>(null);

    const [state, setState] = useState<CamState>('idle');
    const [error, setError] = useState('');
    const [resolution, setResolution] = useState('');
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

    const [modelLoading, setModelLoading] = useState(false);
    const [modelReady, setModelReady] = useState(false);

    // Active Exercise state
    const [activeExerciseId, setActiveExerciseId] = useState<ExerciseId>('squat');
    const currentExercise = EXERCISES.find(e => e.id === activeExerciseId) || EXERCISES[0];

    // Throttled UI states for performance
    const [angles, setAngles] = useState<{ [key: string]: number }>({});
    const [count, setCount] = useState<number>(0);
    const [detectionStage, setDetectionStage] = useState<DetectionStage>('standing');
    const [holdProgress, setHoldProgress] = useState<number>(0);
    const [isBodyVisible, setIsBodyVisible] = useState<boolean>(true);
    
    // Countdown and body distance states
    const [countdown, setCountdown] = useState<string | number | null>(null);
    const [isCountdownActive, setIsCountdownActive] = useState<boolean>(false);
    const [hasWorkoutStarted, setHasWorkoutStarted] = useState<boolean>(false);
    const [bodyDistanceState, setBodyDistanceState] = useState<'ok' | 'close' | 'far' | 'missing'>('missing');

    // Refs for real-time loops to bypass closure/throttling lag
    const activeExerciseIdRef = useRef<ExerciseId>('squat');
    const exerciseStateRef = useRef<{
        stage: DetectionStage;
        holdStartTime: number;
        count: number;
    }>({ stage: 'standing', holdStartTime: 0, count: 0 });
    
    const lastUIUpdateRef = useRef<number>(0);
    const lastDetectionTimeRef = useRef<number>(0);
    const isBodyVisibleRef = useRef<boolean>(true);
    const bodyDistanceStateRef = useRef<'ok' | 'close' | 'far' | 'missing'>('missing');
    const hasWorkoutStartedRef = useRef<boolean>(false);
    const invisibleFrameCountRef = useRef<number>(0);

    // Sync exercise ID to ref
    useEffect(() => {
        activeExerciseIdRef.current = activeExerciseId;
        exerciseStateRef.current = { stage: 'standing', holdStartTime: 0, count: 0 };
        setCount(0);
        setDetectionStage('standing');
        setHoldProgress(0);
    }, [activeExerciseId]);

    // Sync hasWorkoutStarted state to ref
    useEffect(() => {
        hasWorkoutStartedRef.current = hasWorkoutStarted;
    }, [hasWorkoutStarted]);

    // Handle Countdown Trigger when body is visible and camera is live
    useEffect(() => {
        if (state === 'live' && isBodyVisible && bodyDistanceState === 'ok' && !hasWorkoutStarted && !isCountdownActive) {
            setIsCountdownActive(true);
            let countVal = 3;
            setCountdown(countVal);
            playCountdownBeep(false);

            const interval = setInterval(() => {
                countVal -= 1;
                if (countVal > 0) {
                    setCountdown(countVal);
                    playCountdownBeep(false);
                } else if (countVal === 0) {
                    setCountdown('시작!');
                    playCountdownBeep(true);
                } else {
                    clearInterval(interval);
                    setCountdown(null);
                    setHasWorkoutStarted(true);
                    setIsCountdownActive(false);
                }
            }, 1000);

            return () => {
                clearInterval(interval);
                setCountdown(null);
                setIsCountdownActive(false);
            };
        } else if (!isBodyVisible || bodyDistanceState !== 'ok' || state !== 'live') {
            // Cancel countdown if user goes off-screen, stops camera, or gets out of range
            setCountdown(null);
            setIsCountdownActive(false);
            setHasWorkoutStarted(false);
        }
    }, [state, isBodyVisible, bodyDistanceState, hasWorkoutStarted, isCountdownActive]);

    // Diagnostics
    const diag = {
        origin: window.location.origin,
        secureContext: window.isSecureContext,
        hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
    };

    // Load PoseLandmarker WASM Model Offline
    useEffect(() => {
        async function initModel() {
            try {
                setModelLoading(true);
                setError('');
                const vision = await FilesetResolver.forVisionTasks('/wasm');
                const landmarker = await PoseLandmarker.createFromOptions(vision, {
                    baseOptions: {
                        modelAssetPath: '/models/pose_landmarker_lite.task',
                        delegate: 'GPU',
                    },
                    runningMode: 'VIDEO',
                    numPoses: 1,
                });
                landmarkerRef.current = landmarker;
                setModelReady(true);
                setModelLoading(false);
            } catch (e: any) {
                console.error('Error initializing MediaPipe model:', e);
                setError(`모델 로드 실패: ${e.name} - ${e.message}`);
                setModelLoading(false);
            }
        }
        initModel();
    }, []);

    // Load available video devices
    async function loadDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return;
        }
        try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
            setDevices(videoDevices);
            if (videoDevices.length > 0 && !selectedDeviceId) {
                setSelectedDeviceId(videoDevices[0].deviceId);
            }
        } catch (e: any) {
            console.error('Error enumerating devices:', e);
        }
    }

    useEffect(() => {
        loadDevices();
        navigator.mediaDevices?.addEventListener('devicechange', loadDevices);
        return () => {
            navigator.mediaDevices?.removeEventListener('devicechange', loadDevices);
        };
    }, []);

    async function startCamera() {
        setState('requesting');
        setError('');
        try {
            const videoConstraints: MediaTrackConstraints = {
                width: {ideal: 1280},
                height: {ideal: 720}
            };
            if (selectedDeviceId) {
                videoConstraints.deviceId = {exact: selectedDeviceId};
            }
            const stream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: false,
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
            const track = stream.getVideoTracks()[0];
            const s = track.getSettings();
            setResolution(`${s.width}×${s.height} @ ${track.label}`);
            setState('live');

            // Re-load devices so the labels (names) populate after permission is granted
            await loadDevices();
        } catch (e: any) {
            setError(`${e.name}: ${e.message}`);
            setState('error');
        }
    }

    function stopCamera() {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setState('idle');
        setResolution('');
        setHoldProgress(0);
        setDetectionStage('standing');
        setIsBodyVisible(true);
        isBodyVisibleRef.current = true;
        
        // Reset countdown and distance states
        setCountdown(null);
        setIsCountdownActive(false);
        setHasWorkoutStarted(false);
        setBodyDistanceState('missing');
        bodyDistanceStateRef.current = 'missing';
        invisibleFrameCountRef.current = 0;
    }

    const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedDeviceId(e.target.value);
    };

    // Auto-restart camera if it was live and user selects a different device
    useEffect(() => {
        if (state === 'live' && selectedDeviceId) {
            stopCamera();
            startCamera();
        }
    }, [selectedDeviceId]);

    const resetCount = () => {
        exerciseStateRef.current.count = 0;
        setCount(0);
        toast.info('횟수가 초기화되었습니다.');
    };

    // MediaPipe detection loop and state machine
    useEffect(() => {
        let active = true;
        let animationFrameId: number | null = null;

        function drawSkeleton(
            ctx: CanvasRenderingContext2D,
            landmarks: any[],
            width: number,
            height: number,
            anglesData: { [key: string]: number },
            exId: ExerciseId
        ) {
            const connections = [
                [11, 12], [11, 23], [12, 24], [23, 24], // Trunk
                [11, 13], [13, 15], // Left arm
                [12, 14], [14, 16], // Right arm
                [23, 25], [25, 27], // Left leg
                [24, 26], [26, 28]  // Right leg
            ];

            // Draw connection lines
            connections.forEach(([i1, i2]) => {
                const pt1 = landmarks[i1];
                const pt2 = landmarks[i2];
                if (pt1 && pt2 && pt1.visibility > 0.5 && pt2.visibility > 0.5) {
                    const x1 = pt1.x * width;
                    const y1 = pt1.y * height;
                    const x2 = pt2.x * width;
                    const y2 = pt2.y * height;

                    // Compute highlights based on alignment success
                    let strokeColor = '#7c8cff'; // Default accent color

                    if (exId === 'squat') {
                        const isKneeConnection = 
                            (i1 === 23 && i2 === 25) || (i1 === 25 && i2 === 27) || 
                            (i1 === 24 && i2 === 26) || (i1 === 26 && i2 === 28);
                        if (isKneeConnection) {
                            const leftKnee = anglesData['왼쪽 무릎'] || 180;
                            const rightKnee = anglesData['오른쪽 무릎'] || 180;
                            
                            // Yellow-green if in target hold, red if incorrect bending angle
                            const leftOk = leftKnee <= 105;
                            const rightOk = rightKnee <= 105;
                            
                            if (leftOk && rightOk) {
                                strokeColor = '#7ee787'; // Green
                            } else if (leftKnee > 150 && rightKnee > 150) {
                                strokeColor = '#8a8f9c'; // Gray (rest)
                            } else {
                                strokeColor = '#ff5d6c'; // Red (incorrect/transitional)
                            }
                        }
                    } else if (exId === 'arm_raise') {
                        const isShoulderConnection = 
                            (i1 === 23 && i2 === 11) || (i1 === 11 && i2 === 13) || 
                            (i1 === 24 && i2 === 12) || (i1 === 12 && i2 === 14);
                        if (isShoulderConnection) {
                            const leftShoulder = anglesData['왼쪽 어깨'] || 0;
                            const rightShoulder = anglesData['오른쪽 어깨'] || 0;
                            
                            const leftOk = leftShoulder >= 145;
                            const rightOk = rightShoulder >= 145;
                            
                            if (leftOk && rightOk) {
                                strokeColor = '#7ee787';
                            } else if (leftShoulder < 50 && rightShoulder < 50) {
                                strokeColor = '#8a8f9c';
                            } else {
                                strokeColor = '#ff5d6c';
                            }
                        }
                    }

                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = 4;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                }
            });

            // Draw joint dots
            ctx.fillStyle = '#ff5d6c';
            landmarks.forEach((pt, index) => {
                const drawList = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
                if (drawList.includes(index) && pt.visibility > 0.5) {
                    const x = pt.x * width;
                    const y = pt.y * height;
                    ctx.beginPath();
                    ctx.arc(x, y, 6, 0, 2 * Math.PI);
                    ctx.fill();
                }
            });
        }

        const detectLoop = () => {
            if (!active) return;
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const landmarker = landmarkerRef.current;
            const exId = activeExerciseIdRef.current;
            const ex = EXERCISES.find(e => e.id === exId) || EXERCISES[0];

            if (video && canvas && landmarker && state === 'live' && video.readyState >= 2) {
                const now = performance.now();
                if (now - lastDetectionTimeRef.current >= 30) { // Limit to max ~33 FPS for CPU efficiency
                    lastDetectionTimeRef.current = now;

                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                            canvas.width = video.videoWidth;
                            canvas.height = video.videoHeight;
                        }
                        ctx.clearRect(0, 0, canvas.width, canvas.height);

                        const timestamp = performance.now();
                        const result = landmarker.detectForVideo(video, timestamp);

                        let currentAngles: { [key: string]: number } = {};
                        let progressPct = 0;

                        if (result.landmarks && result.landmarks.length > 0) {
                            const landmarks = result.landmarks[0];
                            
                            // Calculate shoulder width to estimate camera distance
                            const shoulderDist = Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y);
                            
                            // Determine if required joints are off-screen or low visibility
                            let isOut = false;
                            let isLowVis = false;
                            
                            // Use only shoulders and hips for presence detection to trigger countdown easily.
                            // If the workout has started, we check all required joints for full exercise analysis.
                            let jointsToCheck = [11, 12, 23, 24]; // shoulders and hips
                            if (hasWorkoutStartedRef.current) {
                                if (exId === 'squat') {
                                    jointsToCheck = [23, 24, 25, 26, 27, 28]; // hips, knees, ankles
                                } else if (exId === 'arm_raise') {
                                    jointsToCheck = [11, 12, 13, 14, 15, 16]; // shoulders, elbows, wrists
                                }
                            }

                            jointsToCheck.forEach(idx => {
                                const pt = landmarks[idx];
                                if (!pt) {
                                    isOut = true;
                                    return;
                                }
                                
                                // Lenient borders (-0.08 to 1.08) prevent minor joint movements near edges from breaking tracking
                                const outOfBounds = pt.x < -0.08 || pt.x > 1.08 || pt.y < -0.08 || pt.y > 1.08;
                                const lowVis = pt.visibility !== undefined && pt.visibility < 0.45;
                                
                                if (outOfBounds) {
                                    isOut = true;
                                }
                                if (lowVis) {
                                    isLowVis = true;
                                }
                            });

                            // Determine distance state based on shoulder distance and joint status
                            if (isOut || shoulderDist > 0.35) {
                                // If joints are off-screen or shoulder distance is too wide, the user is too close
                                invisibleFrameCountRef.current += 1;
                                if (invisibleFrameCountRef.current > 8) { // 8 frames debounce (~250ms at 30fps)
                                    isBodyVisibleRef.current = false;
                                    bodyDistanceStateRef.current = 'close';
                                }
                            } else if (isLowVis) {
                                // If joints are on-screen but visibility is low, it's missing/not detected
                                invisibleFrameCountRef.current += 1;
                                if (invisibleFrameCountRef.current > 8) {
                                    isBodyVisibleRef.current = false;
                                    bodyDistanceStateRef.current = 'missing';
                                }
                            } else if (shoulderDist < 0.08) {
                                // Too far
                                invisibleFrameCountRef.current = 0;
                                isBodyVisibleRef.current = false; // Block/cancel countdown when too far
                                bodyDistanceStateRef.current = 'far';
                            } else {
                                // Everything is OK!
                                invisibleFrameCountRef.current = 0;
                                isBodyVisibleRef.current = true;
                                bodyDistanceStateRef.current = 'ok';
                            }

                            const bodyVisible = isBodyVisibleRef.current;

                            if (bodyVisible) {
                                // Calculate angles
                                ex.joints.forEach(joint => {
                                    const ptA = landmarks[joint.jointA];
                                    const ptB = landmarks[joint.jointB];
                                    const ptC = landmarks[joint.jointC];
                                    if (ptA && ptB && ptC && ptA.visibility > 0.5 && ptB.visibility > 0.5 && ptC.visibility > 0.5) {
                                        currentAngles[joint.name] = Math.round(calculateAngle(ptA, ptB, ptC));
                                    }
                                });

                                // Evaluate State Machine (only if workout has started after countdown)
                                if (hasWorkoutStartedRef.current) {
                                    const stateMachine = exerciseStateRef.current;
                                    const nowMs = Date.now();

                                    let allJointsMatch = true;
                                    ex.joints.forEach(joint => {
                                        const val = currentAngles[joint.name];
                                        if (val === undefined) {
                                            allJointsMatch = false;
                                            return;
                                        }
                                        if (joint.isLessThan) {
                                            if (val > joint.target) allJointsMatch = false;
                                        } else {
                                            if (val < joint.target) allJointsMatch = false;
                                        }
                                    });

                                    let isResting = false;
                                    if (exId === 'squat') {
                                        const leftKnee = currentAngles['왼쪽 무릎'] || 180;
                                        const rightKnee = currentAngles['오른쪽 무릎'] || 180;
                                        if (leftKnee >= 150 && rightKnee >= 150) {
                                            isResting = true;
                                        }
                                    } else if (exId === 'arm_raise') {
                                        const leftShoulder = currentAngles['왼쪽 어깨'] || 0;
                                        const rightShoulder = currentAngles['오른쪽 어깨'] || 0;
                                        if (leftShoulder <= 50 && rightShoulder <= 50) {
                                            isResting = true;
                                        }
                                    }

                                    if (stateMachine.stage === 'standing') {
                                        if (allJointsMatch) {
                                            stateMachine.stage = 'holding';
                                            stateMachine.holdStartTime = nowMs;
                                        } else if (!isResting) {
                                            stateMachine.stage = 'bending';
                                        }
                                    } else if (stateMachine.stage === 'bending') {
                                        if (allJointsMatch) {
                                            stateMachine.stage = 'holding';
                                            stateMachine.holdStartTime = nowMs;
                                        } else if (isResting) {
                                            stateMachine.stage = 'standing';
                                        }
                                    } else if (stateMachine.stage === 'holding') {
                                        if (allJointsMatch) {
                                            const elapsed = nowMs - stateMachine.holdStartTime;
                                            progressPct = Math.min(100, Math.round((elapsed / ex.holdMs) * 100));
                                            
                                            if (elapsed >= ex.holdMs) {
                                                stateMachine.count += 1;
                                                stateMachine.stage = 'success';
                                                progressPct = 100;
                                                
                                                playSuccessBeep();
                                                toast.success(`${ex.name} 성공! ${stateMachine.count}회 완료`);
                                                
                                                EventsEmit('motion:success', {
                                                    exercise: exId,
                                                    count: stateMachine.count,
                                                    timestamp: new Date().toISOString()
                                                });
                                            }
                                        } else {
                                            stateMachine.stage = 'bending';
                                            stateMachine.holdStartTime = 0;
                                        }
                                    } else if (stateMachine.stage === 'success') {
                                        progressPct = 100;
                                        if (isResting) {
                                            stateMachine.stage = 'standing';
                                            progressPct = 0;
                                        }
                                    }
                                }
                            }

                            // Draw overlay skeleton
                            drawSkeleton(ctx, landmarks, canvas.width, canvas.height, currentAngles, exId);
                        } else {
                            invisibleFrameCountRef.current += 1;
                            if (invisibleFrameCountRef.current > 8) {
                                isBodyVisibleRef.current = false;
                                bodyDistanceStateRef.current = 'missing';
                            }
                        }

                        // Throttle React State Updates (every 100ms) for performance
                        const frameTime = performance.now();
                        if (frameTime - lastUIUpdateRef.current > 100) {
                            setAngles(currentAngles);
                            setDetectionStage(exerciseStateRef.current.stage);
                            setCount(exerciseStateRef.current.count);
                            setHoldProgress(progressPct);
                            setIsBodyVisible(isBodyVisibleRef.current);
                            setBodyDistanceState(bodyDistanceStateRef.current);
                            lastUIUpdateRef.current = frameTime;
                        }
                    }
                }
            }

            if (state === 'live') {
                animationFrameId = requestAnimationFrame(detectLoop);
            }
        };

        if (state === 'live' && modelReady) {
            animationFrameId = requestAnimationFrame(detectLoop);
        } else {
            const canvas = canvasRef.current;
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx?.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        return () => {
            active = false;
            if (animationFrameId !== null) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    }, [state, modelReady]);

    useEffect(() => () => stopCamera(), []); // cleanup on unmount

    // Map stages to Korean descriptions without using emojis
    const getStageName = (st: DetectionStage) => {
        switch (st) {
            case 'standing': return '준비 완료 (시작 자세 대기)';
            case 'bending': return '동작 진행 중 (목표 범위 진입 시도)';
            case 'holding': return '자세 유지 중 (버티세요)';
            case 'success': return '성공! 다시 원래 서 있는 자세로 가세요';
            default: return '대기';
        }
    };

    // Function to generate posture correction instructions
    const getGuidanceMessages = () => {
        if (state !== 'live') return ['카메라를 켜고 운동 시작을 눌러주세요.'];
        if (detectionStage === 'success') return ['동작 성공! 서 있는 자세로 복귀하세요.'];
        if (detectionStage === 'standing') {
            if (activeExerciseId === 'squat') return ['바르게 서서 무릎을 펴고 스쿼트를 시작해 주세요.'];
            if (activeExerciseId === 'arm_raise') return ['차려 자세로 서서 만세를 할 준비를 해 주세요.'];
        }
        
        const messages: string[] = [];
        currentExercise.joints.forEach(joint => {
            const curVal = angles[joint.name];
            if (curVal === undefined) return;
            
            const isOk = joint.isLessThan ? curVal <= joint.target : curVal >= joint.target;
            if (!isOk) {
                if (joint.isLessThan) {
                    messages.push(`${joint.name} 각도를 조금 더 굽히세요 (현재: ${curVal}°, 목표: ${joint.target}° 이하)`);
                } else {
                    messages.push(`${joint.name}를 조금 더 들어 올리세요 (현재: ${curVal}°, 목표: ${joint.target}° 이상)`);
                }
            }
        });
        
        if (messages.length === 0 && detectionStage === 'holding') {
            return ['자세를 그대로 유지해 주세요.'];
        }
        
        return messages.length > 0 ? messages : ['자세를 준비하는 중입니다.'];
    };

    return (
        <div id="App">
            <Toaster theme="dark" position="top-right" duration={4000} />
            
            <header className="app-header">
                <div className="header-left">
                    <h1>EduMove</h1>
                    <p className="subtitle">웹캠 동작 인식 AI 학습 솔루션</p>
                </div>
                <div className="header-right">
                    <span className="badge">MediaPipe WASM (Lite)</span>
                </div>
            </header>

            <main className="dashboard">
                {/* Left Panel: Configuration and Status Card */}
                <section className="panel-left">
                    <div className="card">
                        <h3>운동 프로그램 선택</h3>
                        <div className="exercise-selector">
                            {EXERCISES.map(ex => (
                                <button
                                    key={ex.id}
                                    className={`btn-selector ${activeExerciseId === ex.id ? 'active' : ''}`}
                                    onClick={() => setActiveExerciseId(ex.id)}
                                >
                                    {ex.name}
                                </button>
                            ))}
                        </div>
                        <p className="exercise-desc">{currentExercise.description}</p>
                    </div>

                    <div className="card status-card">
                        <h3>실시간 동작 판정 상태</h3>
                        
                        <div className="stage-indicator">
                            <span className="label">진행 상황</span>
                            <span className={`value stage-${detectionStage}`}>{getStageName(detectionStage)}</span>
                        </div>

                        {/* Real-time Posture Guidance Feed */}
                        <div className={`guidance-feed ${!isBodyVisible ? 'danger-feed' : ''}`}>
                            <h4>실시간 자세 가이드</h4>
                            <div className="guidance-list">
                                {getGuidanceMessages().map((msg, index) => (
                                    <div 
                                        key={index} 
                                        className={`guidance-item ${
                                            !isBodyVisible 
                                                ? 'danger-guide' 
                                                : detectionStage === 'holding' && msg.includes('유지') 
                                                    ? 'success-guide' 
                                                    : 'warning-guide'
                                        }`}
                                    >
                                        <span className="guidance-dot"></span>
                                        <span className="guidance-text">{msg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Hold Duration progress bar */}
                        {holdProgress > 0 && (
                            <div className="progress-bar-container">
                                <div className="progress-bar-label">유지 시간 ({currentExercise.holdMs}ms)</div>
                                <div className="progress-bar">
                                    <div className="progress-fill" style={{ width: `${holdProgress}%` }}></div>
                                </div>
                            </div>
                        )}

                        <div className="joint-angles-list">
                            <h4>관절 실시간 각도</h4>
                            {currentExercise.joints.map(joint => {
                                const curVal = angles[joint.name];
                                const isOk = curVal !== undefined && (
                                    joint.isLessThan ? curVal <= joint.target : curVal >= joint.target
                                );
                                return (
                                    <div key={joint.name} className="joint-angle-item">
                                        <span className="joint-name">{joint.name}</span>
                                        <span className={`joint-value ${isOk ? 'matching' : 'not-matching'}`}>
                                            {curVal !== undefined ? `${curVal}°` : '대기'} 
                                            <span className="joint-target-range">
                                                (목표: {joint.isLessThan ? '≤' : '≥'} {joint.target}°)
                                            </span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="card count-card">
                        <div className="count-display">
                            <span className="count-label">성공 횟수</span>
                            <span className="count-number">{count}회</span>
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={resetCount}>기록 초기화</button>
                    </div>
                </section>

                {/* Right Panel: Camera Feed and Diagnostics */}
                <section className="panel-right">
                    <div className="card camera-card">
                        <div className="controls">
                            {devices.length > 0 && (
                                <div className="device-select-container">
                                    <label htmlFor="device-select">카메라 선택: </label>
                                    <select
                                        id="device-select"
                                        value={selectedDeviceId}
                                        onChange={handleDeviceChange}
                                        disabled={state === 'requesting'}
                                        className="select-input"
                                    >
                                        {devices.map((device, index) => (
                                            <option key={device.deviceId || index} value={device.deviceId}>
                                                {device.label || `카메라 ${index + 1}`}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {state !== 'live' ? (
                                <button
                                    className="btn btn-primary"
                                    onClick={startCamera}
                                    disabled={state === 'requesting' || !diag.hasGetUserMedia || !modelReady}
                                >
                                    {!modelReady ? '모델 로딩 중…' : state === 'requesting' ? '카메라 요청 중…' : '운동 시작'}
                                </button>
                            ) : (
                                <button className="btn btn-danger" onClick={stopCamera}>운동 정지</button>
                            )}
                        </div>

                        <div className="stage">
                            <video ref={videoRef} className="cam" playsInline muted />
                            <canvas ref={canvasRef} className="canvas-overlay" />
                            {state === 'idle' && (
                                <div className="cam-placeholder">
                                    <span>운동 시작 버튼을 클릭해 카메라를 켜세요.</span>
                                </div>
                            )}

                            {/* Proximity / Detection Warning Overlay */}
                            {state === 'live' && bodyDistanceState !== 'ok' && (
                                <div className={`status-overlay ${bodyDistanceState}`}>
                                    <div className="status-overlay-content">
                                        <div className="status-overlay-title">
                                            {bodyDistanceState === 'close' && '너무 가깝습니다!'}
                                            {bodyDistanceState === 'far' && '너무 멉니다!'}
                                            {bodyDistanceState === 'missing' && '미감지 상태'}
                                        </div>
                                        <div className="status-overlay-desc">
                                            {bodyDistanceState === 'close' && '뒤로 물러서세요.'}
                                            {bodyDistanceState === 'far' && '앞으로 다가오세요.'}
                                            {bodyDistanceState === 'missing' && '카메라 앞에 서 주세요.'}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Countdown/Start Popup Overlay */}
                            {countdown !== null && (
                                <div className="countdown-overlay">
                                    <div className="countdown-content">
                                        <div className="countdown-number">{countdown}</div>
                                        <div className="countdown-label">
                                            {countdown === '시작!' ? '운동 화이팅!' : '카메라 정면을 보고 준비해 주세요'}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        <div className="feed-info">
                            {state === 'live' ? (
                                <span className="status-live">스트림 라이브 · {resolution}</span>
                            ) : (
                                <span className="status-offline">카메라 정지됨</span>
                            )}
                        </div>
                    </div>

                    <div className="card diag-card">
                        <h3>시스템 환경 진단</h3>
                        <table className="diag">
                            <tbody>
                                <tr>
                                    <td>origin</td>
                                    <td>{diag.origin}</td>
                                </tr>
                                <tr>
                                    <td>isSecureContext</td>
                                    <td className={diag.secureContext ? 'yes' : 'no'}>
                                        {diag.secureContext ? '정상' : '보안 취약 (카메라 차단)'}
                                    </td>
                                </tr>
                                <tr>
                                    <td>MediaPipe Model</td>
                                    <td className={modelReady ? 'yes' : 'no'}>
                                        {modelLoading ? '로딩 중' : modelReady ? '로드 완료' : '미로드'}
                                    </td>
                                </tr>
                                <tr>
                                    <td>Body Detected</td>
                                    <td className={isBodyVisible ? 'yes' : 'no'}>
                                        {isBodyVisible ? '정상 (전신 감지)' : '미감지 (가까움/가려짐)'}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>
            </main>
        </div>
    );
}

export default App;
