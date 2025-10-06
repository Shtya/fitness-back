const full_body_starter = {
    "name": "Full Body Starter",
    "level": "beginner",
    "duration": "8 weeks",
    "program": {
        "days": [
            {
                "id": "saturday",
                "dayOfWeek": "saturday",
                "name": "Full Body A",
                "exercises": [
                    {
                        "name": "Barbell Squat",
                        "targetSets": 3,
                        "targetReps": "8-12",
                        "rest": 90,
                        "tempo": "3-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/barbell-squat-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=SW_C1A-rejs",
                        "orderIndex": 1
                    },
                    {
                        "name": "Bench Press",
                        "targetSets": 3,
                        "targetReps": "8-12",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/bench-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=vcBig73ojpE",
                        "orderIndex": 2
                    },
                    {
                        "name": "Bent Over Rows",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/bent-over-row-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=FWJR5Ve8bnQ",
                        "orderIndex": 3
                    },
                    {
                        "name": "Overhead Press",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/overhead-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=2yjwXTZQDDI",
                        "orderIndex": 4
                    },
                    {
                        "name": "Plank",
                        "targetSets": 3,
                        "targetReps": "30-60 seconds",
                        "rest": 60,
                        "tempo": "hold",
                        "img": "https://www.bodybuilding.com/images/2021/april/plank-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=pSHjTRCQxIw",
                        "orderIndex": 5
                    }
                ]
            },
            {
                "id": "monday",
                "dayOfWeek": "monday",
                "name": "Full Body B",
                "exercises": [
                    {
                        "name": "Deadlift",
                        "targetSets": 3,
                        "targetReps": "6-8",
                        "rest": 120,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/deadlift-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=op9kVnSso6Q",
                        "orderIndex": 1
                    },
                    {
                        "name": "Pull-ups",
                        "targetSets": 3,
                        "targetReps": "6-10",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/pull-up-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=eGo4IYlbE5g",
                        "orderIndex": 2
                    },
                    {
                        "name": "Incline Dumbbell Press",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/incline-dumbbell-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=0G2_XV7slIg",
                        "orderIndex": 3
                    },
                    {
                        "name": "Leg Press",
                        "targetSets": 3,
                        "targetReps": "12-15",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/leg-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=IZxyjW7MPJQ",
                        "orderIndex": 4
                    },
                    {
                        "name": "Russian Twists",
                        "targetSets": 3,
                        "targetReps": "15-20",
                        "rest": 60,
                        "tempo": "2-0-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/russian-twist-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=wkD8rjkodUI",
                        "orderIndex": 5
                    }
                ]
            }
        ]
    }
}

const push_pull_legs = {
    "name": "Push Pull Legs Advanced",
    "level": "intermediate",
    "duration": "12 weeks",
    "program": {
        "days": [
            {
                "id": "push1",
                "dayOfWeek": "monday",
                "name": "Push Day",
                "exercises": [
                    {
                        "name": "Barbell Bench Press",
                        "targetSets": 4,
                        "targetReps": "6-8",
                        "rest": 120,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/bench-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=vcBig73ojpE",
                        "orderIndex": 1
                    },
                    {
                        "name": "Overhead Press",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/overhead-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=2yjwXTZQDDI",
                        "orderIndex": 2
                    },
                    {
                        "name": "Incline Dumbbell Press",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/incline-dumbbell-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=0G2_XV7slIg",
                        "orderIndex": 3
                    },
                    {
                        "name": "Dumbbell Lateral Raises",
                        "targetSets": 3,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/lateral-raise-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=3VcKaXpzqRo",
                        "orderIndex": 4
                    },
                    {
                        "name": "Triceps Pushdown",
                        "targetSets": 3,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/triceps-pushdown-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=2-LAMcpzODU",
                        "orderIndex": 5
                    }
                ]
            },
            {
                "id": "pull1",
                "dayOfWeek": "tuesday",
                "name": "Pull Day",
                "exercises": [
                    {
                        "name": "Deadlift",
                        "targetSets": 3,
                        "targetReps": "4-6",
                        "rest": 180,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/deadlift-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=op9kVnSso6Q",
                        "orderIndex": 1
                    },
                    {
                        "name": "Pull-ups",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/pull-up-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=eGo4IYlbE5g",
                        "orderIndex": 2
                    },
                    {
                        "name": "Barbell Rows",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/bent-over-row-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=FWJR5Ve8bnQ",
                        "orderIndex": 3
                    },
                    {
                        "name": "Face Pulls",
                        "targetSets": 3,
                        "targetReps": "15-20",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/face-pull-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=fozNc3gCqus",
                        "orderIndex": 4
                    },
                    {
                        "name": "Barbell Curls",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/barbell-curl-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=kwG2ipFRgfo",
                        "orderIndex": 5
                    }
                ]
            },
            {
                "id": "legs1",
                "dayOfWeek": "wednesday",
                "name": "Legs Day",
                "exercises": [
                    {
                        "name": "Barbell Squat",
                        "targetSets": 4,
                        "targetReps": "6-8",
                        "rest": 120,
                        "tempo": "3-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/barbell-squat-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=SW_C1A-rejs",
                        "orderIndex": 1
                    },
                    {
                        "name": "Romanian Deadlift",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 90,
                        "tempo": "3-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/romanian-deadlift-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=JCXUYuzwNrM",
                        "orderIndex": 2
                    },
                    {
                        "name": "Leg Press",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/leg-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=IZxyjW7MPJQ",
                        "orderIndex": 3
                    },
                    {
                        "name": "Leg Curls",
                        "targetSets": 3,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/leg-curl-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=1Tq3QdYUuHs",
                        "orderIndex": 4
                    },
                    {
                        "name": "Calf Raises",
                        "targetSets": 4,
                        "targetReps": "15-20",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/calf-raise-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=JbyjNymZOt0",
                        "orderIndex": 5
                    }
                ]
            }
        ]
    }
}

const bro_split = {
    "name": "Advanced Bodybuilding Split",
    "level": "advanced",
    "duration": "16 weeks",
    "program": {
        "days": [
            {
                "id": "chest",
                "dayOfWeek": "monday",
                "name": "Chest Day",
                "exercises": [
                    {
                        "name": "Incline Barbell Press",
                        "targetSets": 4,
                        "targetReps": "6-8",
                        "rest": 120,
                        "tempo": "3-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/incline-bench-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=SrqOu55lrYU",
                        "orderIndex": 1
                    },
                    {
                        "name": "Flat Dumbbell Press",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/dumbbell-bench-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=VQ6egnbN3EY",
                        "orderIndex": 2
                    },
                    {
                        "name": "Cable Crossovers",
                        "targetSets": 3,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/cable-crossover-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=taI4Xdua8WM",
                        "orderIndex": 3
                    },
                    {
                        "name": "Dips",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/dips-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=2-c1r1YLt_k",
                        "orderIndex": 4
                    }
                ]
            },
            {
                "id": "back",
                "dayOfWeek": "tuesday",
                "name": "Back Day",
                "exercises": [
                    {
                        "name": "Weighted Pull-ups",
                        "targetSets": 4,
                        "targetReps": "6-8",
                        "rest": 120,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/pull-up-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=eGo4IYlbE5g",
                        "orderIndex": 1
                    },
                    {
                        "name": "Barbell Rows",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/bent-over-row-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=FWJR5Ve8bnQ",
                        "orderIndex": 2
                    },
                    {
                        "name": "T-Bar Rows",
                        "targetSets": 3,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/t-bar-row-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=j3Igk5nyZE4",
                        "orderIndex": 3
                    },
                    {
                        "name": "Lat Pulldowns",
                        "targetSets": 3,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/lat-pulldown-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=CAwf7n6Luuc",
                        "orderIndex": 4
                    }
                ]
            },
            {
                "id": "shoulders",
                "dayOfWeek": "wednesday",
                "name": "Shoulders & Arms",
                "exercises": [
                    {
                        "name": "Military Press",
                        "targetSets": 4,
                        "targetReps": "6-8",
                        "rest": 120,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/military-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=2yjwXTZQDDI",
                        "orderIndex": 1
                    },
                    {
                        "name": "Dumbbell Lateral Raises",
                        "targetSets": 4,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/lateral-raise-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=3VcKaXpzqRo",
                        "orderIndex": 2
                    },
                    {
                        "name": "Barbell Curls",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/barbell-curl-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=kwG2ipFRgfo",
                        "orderIndex": 3
                    },
                    {
                        "name": "Skull Crushers",
                        "targetSets": 4,
                        "targetReps": "10-12",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/skull-crusher-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=d_KZxkY_0cM",
                        "orderIndex": 4
                    }
                ]
            },
            {
                "id": "legs",
                "dayOfWeek": "friday",
                "name": "Legs Day",
                "exercises": [
                    {
                        "name": "Barbell Squat",
                        "targetSets": 5,
                        "targetReps": "5-8",
                        "rest": 150,
                        "tempo": "3-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/barbell-squat-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=SW_C1A-rejs",
                        "orderIndex": 1
                    },
                    {
                        "name": "Romanian Deadlift",
                        "targetSets": 4,
                        "targetReps": "8-10",
                        "rest": 120,
                        "tempo": "3-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/romanian-deadlift-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=JCXUYuzwNrM",
                        "orderIndex": 2
                    },
                    {
                        "name": "Leg Press",
                        "targetSets": 4,
                        "targetReps": "10-12",
                        "rest": 90,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/leg-press-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=IZxyjW7MPJQ",
                        "orderIndex": 3
                    },
                    {
                        "name": "Walking Lunges",
                        "targetSets": 3,
                        "targetReps": "12-15 per leg",
                        "rest": 75,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/walking-lunge-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=L8fvypPrzzs",
                        "orderIndex": 4
                    }
                ]
            }
        ]
    }
}

const weight_loss_program = {
    "name": "Fat Loss & Conditioning",
    "level": "all levels",
    "duration": "8 weeks",
    "program": {
        "days": [
            {
                "id": "hiit1",
                "dayOfWeek": "monday",
                "name": "HIIT Cardio & Core",
                "exercises": [
                    {
                        "name": "Burpees",
                        "targetSets": 5,
                        "targetReps": "30 seconds work, 30 rest",
                        "rest": 30,
                        "tempo": "explosive",
                        "img": "https://www.bodybuilding.com/images/2021/april/burpee-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=auBLPXO8Fww",
                        "orderIndex": 1
                    },
                    {
                        "name": "Mountain Climbers",
                        "targetSets": 5,
                        "targetReps": "30 seconds work, 30 rest",
                        "rest": 30,
                        "tempo": "fast",
                        "img": "https://www.bodybuilding.com/images/2021/april/mountain-climber-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=nmwgirgXLYM",
                        "orderIndex": 2
                    },
                    {
                        "name": "Jump Squats",
                        "targetSets": 5,
                        "targetReps": "30 seconds work, 30 rest",
                        "rest": 30,
                        "tempo": "explosive",
                        "img": "https://www.bodybuilding.com/images/2021/april/jump-squat-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=CVaEhXotL7M",
                        "orderIndex": 3
                    },
                    {
                        "name": "Plank",
                        "targetSets": 3,
                        "targetReps": "60 seconds",
                        "rest": 45,
                        "tempo": "hold",
                        "img": "https://www.bodybuilding.com/images/2021/april/plank-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=pSHjTRCQxIw",
                        "orderIndex": 4
                    }
                ]
            },
            {
                "id": "strength1",
                "dayOfWeek": "tuesday",
                "name": "Full Body Strength",
                "exercises": [
                    {
                        "name": "Kettlebell Swings",
                        "targetSets": 4,
                        "targetReps": "15-20",
                        "rest": 60,
                        "tempo": "explosive",
                        "img": "https://www.bodybuilding.com/images/2021/april/kettlebell-swing-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=m4k-0T4nJdI",
                        "orderIndex": 1
                    },
                    {
                        "name": "Dumbbell Thrusters",
                        "targetSets": 4,
                        "targetReps": "12-15",
                        "rest": 60,
                        "tempo": "2-0-1",
                        "img": "https://www.bodybuilding.com/images/2021/april/dumbbell-thruster-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=Y1fJbJN6B4U",
                        "orderIndex": 2
                    },
                    {
                        "name": "Renegade Rows",
                        "targetSets": 3,
                        "targetReps": "10-12 per arm",
                        "rest": 60,
                        "tempo": "2-1-2",
                        "img": "https://www.bodybuilding.com/images/2021/april/renegade-row-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=RD6S5OuU_1I",
                        "orderIndex": 3
                    },
                    {
                        "name": "Box Jumps",
                        "targetSets": 4,
                        "targetReps": "10-12",
                        "rest": 60,
                        "tempo": "explosive",
                        "img": "https://www.bodybuilding.com/images/2021/april/box-jump-header-830x467.jpg",
                        "video": "https://www.youtube.com/watch?v=D2t1zyqTjMw",
                        "orderIndex": 4
                    }
                ]
            }
        ]
    }
}