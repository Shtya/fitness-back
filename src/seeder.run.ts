// // seed-all-data.ts
// import { DataSource } from 'typeorm';
// import { faker } from '@faker-js/faker';
// import * as bcrypt from 'bcrypt';

// // Import all your entities
// import { User } from 'entities/user.entity';
// import { Role } from 'entities/role.entity';
// import { Permission } from 'entities/permissions.entity';
// import { Asset } from 'entities/assets.entity';
// import { 
//   UserPreference, InviteCode, Subscription, Payment, MediaAsset ,
// 	ExerciseCategory, Exercise, ExerciseMedia, ExerciseAlternative ,
// 	Workout, WorkoutExercise, ProgramTemplate, ProgramTemplateDay, 
// 	AssignedProgram, WorkoutSetLog, CardioSession ,
// 	Food, FoodSubstitution, Meal, MealItem, DietPlanTemplate, 
// 	AssignedDiet, MealLog, WaterIntake, SupplementLog ,
// 	Progress, SleepLog, StepsLog, WeeklyCheckin, WeeklyAnalysis  ,
// 	FormTemplate, FormResponse, Message, Notification ,
// 	StaffTask, AuditLog 
// } from 'entities/global.entity';


// export class CompleteSeeder {
//   constructor(private dataSource: DataSource) {}

//   // Store references to created entities for relationships
//   private permissions: Permission[] = [];
//   private roles: Role[] = [];
//   private users: User[] = [];
//   private coaches: User[] = [];
//   private clients: User[] = [];
//   private exerciseCategories: ExerciseCategory[] = [];
//   private exercises: Exercise[] = [];
//   private workouts: Workout[] = [];
//   private programTemplates: ProgramTemplate[] = [];
//   private foods: Food[] = [];
//   private meals: Meal[] = [];
//   private dietPlanTemplates: DietPlanTemplate[] = [];
//   private mediaAssets: MediaAsset[] = [];

//   async seed() {
//     try {
//       console.log('Starting complete data seeding...');
      
//       // Clear existing data (be careful with this in production!)
//       await this.clearDatabase();
      
//       // Seed in the correct order to respect foreign key constraints
//       await this.seedPermissions();
//       await this.seedRoles();
//       await this.seedUsers();
//       await this.seedUserPreferences();
//       await this.seedAssets();
//       await this.seedInviteCodes();
//       await this.seedSubscriptionsAndPayments();
//       await this.seedMediaAssets();
//       await this.seedExerciseCategories();
//       await this.seedExercises();
//       await this.seedExerciseMedia();
//       await this.seedExerciseAlternatives();
//       await this.seedWorkouts();
//       await this.seedWorkoutExercises();
//       await this.seedProgramTemplates();
//       await this.seedProgramTemplateDays();
//       await this.seedAssignedPrograms();
//       await this.seedWorkoutSetLogs();
//       await this.seedCardioSessions();
//       await this.seedFoods();
//       await this.seedFoodSubstitutions();
//       await this.seedMeals();
//       await this.seedMealItems();
//       await this.seedDietPlanTemplates();
//       await this.seedAssignedDiets();
//       await this.seedMealLogs();
//       await this.seedWaterIntake();
//       await this.seedSupplementLogs();
//       await this.seedProgress();
//       await this.seedSleepLogs();
//       await this.seedStepsLogs();
//       await this.seedWeeklyCheckins();
//       await this.seedWeeklyAnalyses();
//       await this.seedFormTemplates();
//       await this.seedFormResponses();
//       await this.seedMessages();
//       await this.seedNotifications();
//       await this.seedStaffTasks();
//       await this.seedAuditLogs();
      
//       console.log('Complete data seeding finished successfully!');
//     } catch (error) {
//       console.error('Error seeding data:', error);
//       throw error;
//     }
//   }

//   private async clearDatabase() {
//     console.log('Clearing database...');
//     const entities = this.dataSource.entityMetadatas;
    
//     // Delete in reverse order to respect foreign key constraints
//     for (const entity of entities.reverse()) {
//       const repository = this.dataSource.getRepository(entity.name);
//       try {
//         await repository.query(`DELETE FROM "${entity.tableName}"`);
//         console.log(`Cleared table: ${entity.tableName}`);
//       } catch (error) {
//         console.warn(`Could not clear table ${entity.tableName}:`, error.message);
//       }
//     }
//   }

//   private async seedPermissions() {
//     console.log('Seeding permissions...');
//     const permissionRepository = this.dataSource.getRepository(Permission);
    
//     const permissions = [
//       { name: 'manage_users', description: 'Can manage users' },
//       { name: 'manage_workouts', description: 'Can manage workouts' },
//       { name: 'manage_nutrition', description: 'Can manage nutrition plans' },
//       { name: 'view_reports', description: 'Can view reports' },
//       { name: 'manage_staff', description: 'Can manage staff' },
//       { name: 'manage_content', description: 'Can manage content' },
//       { name: 'view_dashboard', description: 'Can view dashboard' },
//       { name: 'create_invites', description: 'Can create invite codes' },
//       { name: 'assign_programs', description: 'Can assign programs to clients' },
//       { name: 'view_client_data', description: 'Can view client data' },
//     ];
    
//     this.permissions = await permissionRepository.save(permissions);
//   }

//   private async seedRoles() {
//     console.log('Seeding roles...');
//     const roleRepository = this.dataSource.getRepository(Role);
    
//     const roles = [
//       {
//         name: 'admin',
//         description: 'Administrator with full access',
//         permissions: this.permissions
//       },
//       {
//         name: 'coach',
//         description: 'Fitness coach',
//         permissions: this.permissions.filter(p => 
//           !['manage_staff', 'manage_users'].includes(p.name)
//         )
//       },
//       {
//         name: 'client',
//         description: 'Regular client',
//         permissions: this.permissions.filter(p => 
//           ['view_dashboard'].includes(p.name)
//         )
//       },
//       {
//         name: 'staff',
//         description: 'Staff member',
//         permissions: this.permissions.filter(p => 
//           ['view_reports', 'view_dashboard', 'view_client_data'].includes(p.name)
//         )
//       }
//     ];
    
//     this.roles = await roleRepository.save(roles);
//   }

//   private async seedUsers() {
//     console.log('Seeding users...');
//     const userRepository = this.dataSource.getRepository(User);
    
//     // Create admin user
//     const adminUser = new User();
//     adminUser.username = 'admin';
//     adminUser.email = 'admin@fitness.com';
//     adminUser.password = await bcrypt.hash('admin123', 10);
//     adminUser.role = this.roles.find(r => r.name === 'admin');
//     adminUser.age = 35;
//     adminUser.height = 180;
//     adminUser.weight = 80;
//     adminUser.gender = 'male';
//     adminUser.is_active = true;
    
//     // Create coaches
//     this.coaches = [];
//     for (let i = 0; i < 5; i++) {
//       const coach = new User();
//       coach.username = `coach${i+1}`;
//       coach.email = `coach${i+1}@fitness.com`;
//       coach.password = await bcrypt.hash('coach123', 10);
//       coach.role = this.roles.find(r => r.name === 'coach');
//       coach.age = faker.number.int({ min: 25, max: 45 });
//       coach.height = faker.number.int({ min: 165, max: 195 });
//       coach.weight = faker.number.int({ min: 65, max: 95 });
//       coach.gender = faker.helpers.arrayElement(['male', 'female']);
//       coach.is_active = true;
//       coach.created_by = adminUser;
      
//       this.coaches.push(coach);
//     }
    
//     // Create clients (assigned to coaches)
//     this.clients = [];
//     for (let i = 0; i < 30; i++) {
//       const client = new User();
//       client.username = `client${i+1}`;
//       client.email = `client${i+1}@fitness.com`;
//       client.password = await bcrypt.hash('client123', 10);
//       client.role = this.roles.find(r => r.name === 'client');
//       client.age = faker.number.int({ min: 18, max: 65 });
//       client.height = faker.number.int({ min: 150, max: 200 });
//       client.weight = faker.number.int({ min: 50, max: 120 });
//       client.gender = faker.helpers.arrayElement(['male', 'female']);
//       client.is_active = true;
//       client.coach = faker.helpers.arrayElement(this.coaches);
//       client.created_by = adminUser;
      
//       this.clients.push(client);
//     }
    
//     this.users = [adminUser, ...this.coaches, ...this.clients];
//     await userRepository.save(this.users);
//   }

//   private async seedUserPreferences() {
//     console.log('Seeding user preferences...');
//     const preferenceRepository = this.dataSource.getRepository(UserPreference);
    
//     const preferences = this.users.map(user => {
//       const preference = new UserPreference();
//       preference.user = user;
//       preference.settings = {
//         prayerReminders: faker.datatype.boolean(),
//         restTimerDefault: faker.number.int({ min: 30, max: 90 }),
//         unitSystem: faker.helpers.arrayElement(['metric', 'imperial']),
//         language: faker.helpers.arrayElement(['en', 'ar']),
//         notifications: {
//           email: faker.datatype.boolean(),
//           push: faker.datatype.boolean(),
//           sms: faker.datatype.boolean()
//         }
//       };
//       return preference;
//     });
    
//     await preferenceRepository.save(preferences);
//   }

//   private async seedAssets() {
//     console.log('Seeding assets...');
//     const assetRepository = this.dataSource.getRepository(Asset);
    
//     const assets = [];
//     for (const user of this.users) {
//       for (let i = 0; i < faker.number.int({ min: 1, max: 5 }); i++) {
//         const asset = new Asset();
//         asset.filename = faker.system.fileName();
//         asset.url = faker.image.url();
//         asset.type = faker.helpers.arrayElement(['profile', 'workout', 'progress', 'other']);
//         asset.category = faker.helpers.arrayElement(['image', 'video', 'document']);
//         asset.mimeType = faker.helpers.arrayElement(['image/jpeg', 'image/png', 'video/mp4', 'application/pdf']);
//         asset.size = faker.number.int({ min: 1000, max: 10000000 });
//         asset.user = user;
        
//         assets.push(asset);
//       }
//     }
    
//     await assetRepository.save(assets);
//   }

//   private async seedInviteCodes() {
//     console.log('Seeding invite codes...');
//     const inviteCodeRepository = this.dataSource.getRepository(InviteCode);
    
//     const inviteCodes = [];
//     for (const coach of this.coaches) {
//       for (let i = 0; i < 3; i++) {
//         const inviteCode:any = new InviteCode();
//         inviteCode.code = faker.string.alphanumeric(8).toUpperCase();
//         inviteCode.coach = coach;
//         inviteCode.expiresAt = faker.date.future();
//         inviteCode.used = faker.datatype.boolean();
        
//         if (inviteCode.used) {
//           inviteCode.usedByUserId = faker.helpers.arrayElement(this.clients).id;
//         }
        
//         inviteCodes.push(inviteCode);
//       }
//     }
    
//     await inviteCodeRepository.save(inviteCodes);
//   }

//   private async seedSubscriptionsAndPayments() {
//     console.log('Seeding subscriptions and payments...');
//     const subscriptionRepository = this.dataSource.getRepository(Subscription);
//     const paymentRepository = this.dataSource.getRepository(Payment);
    
//     const subscriptions = [];
//     const payments = [];
    
//     for (const client of this.clients) {
//       const subscription = new Subscription();
//       subscription.user = client;
//       subscription.planType = faker.helpers.arrayElement(['monthly', 'quarterly', 'semiannual', 'annual']);
//       subscription.status = faker.helpers.arrayElement(['active', 'expired', 'pending', 'canceled']);
//       subscription.startDate = faker.date.past();
//       subscription.endDate = faker.date.future();
      
//       subscriptions.push(subscription);
      
//       // Create payments for each subscription
//       for (let i = 0; i < faker.number.int({ min: 1, max: 3 }); i++) {
//         const payment = new Payment();
//         payment.subscription = subscription;
//         payment.amount = faker.number.float({ min: 100, max: 1000, fractionDigits: 2 });
//         payment.currency = 'EGP';
//         payment.method = faker.helpers.arrayElement(['cash', 'card', 'transfer']);
//         payment.status = faker.helpers.arrayElement(['paid', 'pending', 'failed']);
//         payment.createdAt = faker.date.past();
        
//         payments.push(payment);
//       }
//     }
    
//     await subscriptionRepository.save(subscriptions);
//     await paymentRepository.save(payments);
//   }

//   private async seedMediaAssets() {
//     console.log('Seeding media assets...');
//     const mediaAssetRepository = this.dataSource.getRepository(MediaAsset);
    
//     this.mediaAssets = [];
//     for (const coach of this.coaches) {
//       for (let i = 0; i < faker.number.int({ min: 5, max: 10 }); i++) {
//         const mediaAsset = new MediaAsset();
//         mediaAsset.coach = coach;
//         mediaAsset.type = faker.helpers.arrayElement(['video', 'image', 'pdf']);
//         mediaAsset.url = faker.image.url();
//         mediaAsset.title = faker.lorem.words(3);
//         mediaAsset.description = faker.lorem.sentence();
//         mediaAsset.createdAt = faker.date.past();
        
//         this.mediaAssets.push(mediaAsset);
//       }
//     }
    
//     await mediaAssetRepository.save(this.mediaAssets);
//   }

//   private async seedExerciseCategories() {
//     console.log('Seeding exercise categories...');
//     const categoryRepository = this.dataSource.getRepository(ExerciseCategory);
    
//     const categories = [
//       'Chest', 'Back', 'Legs', 'Shoulders', 'Arms', 'Core', 
//       'Cardio', 'Full Body', 'Flexibility', 'Warm-up'
//     ].map(name => {
//       const category = new ExerciseCategory();
//       category.name = name;
//       return category;
//     });
    
//     this.exerciseCategories = await categoryRepository.save(categories);
//   }

//   private async seedExercises() {
//     console.log('Seeding exercises...');
//     const exerciseRepository = this.dataSource.getRepository(Exercise);
    
//     const exerciseNames = [
//       'Bench Press', 'Squat', 'Deadlift', 'Pull-up', 'Push-up', 
//       'Shoulder Press', 'Bicep Curl', 'Tricep Extension', 'Leg Press',
//       'Lat Pulldown', 'Chest Fly', 'Leg Curl', 'Leg Extension', 'Calf Raise',
//       'Plank', 'Crunch', 'Russian Twist', 'Lunge', 'Jumping Jacks', 'Burpee',
//       'Dumbbell Row', 'Lat Raise', 'Front Raise', 'Shrug', 'Face Pull',
//       'Hammer Curl', 'Preacher Curl', 'Skull Crusher', 'Dip', 'Leg Raise',
//       'Hip Thrust', 'Good Morning', 'Box Jump', 'Mountain Climber', 'Kettlebell Swing'
//     ];
    
//     this.exercises = [];
//     for (const name of exerciseNames) {
//       const exercise = new Exercise();
//       exercise.name = name;
//       exercise.description = faker.lorem.sentence();
//       exercise.category = faker.helpers.arrayElement(this.exerciseCategories);
//       exercise.equipment = faker.helpers.arrayElement(['machine', 'cable', 'dumbbell', 'barbell', 'bodyweight', 'kettlebell']);
//       exercise.primaryMuscle = faker.helpers.arrayElement(['chest', 'back', 'legs', 'shoulders', 'arms', 'core']);
      
//       this.exercises.push(exercise);
//     }
    
//     await exerciseRepository.save(this.exercises);
//   }

//   private async seedExerciseMedia() {
//     console.log('Seeding exercise media...');
//     const exerciseMediaRepository = this.dataSource.getRepository(ExerciseMedia);
    
//     const exerciseMedias = [];
//     for (const exercise of this.exercises) {
//       for (let i = 0; i < faker.number.int({ min: 1, max: 3 }); i++) {
//         const exerciseMedia = new ExerciseMedia();
//         exerciseMedia.exercise = exercise;
//         exerciseMedia.fromLibrary = faker.helpers.arrayElement(this.mediaAssets);
//         exerciseMedia.type = faker.helpers.arrayElement(['video', 'image']);
//         exerciseMedia.url = faker.image.url();
//         exerciseMedia.note = faker.lorem.sentence();
        
//         exerciseMedias.push(exerciseMedia);
//       }
//     }
    
//     await exerciseMediaRepository.save(exerciseMedias);
//   }

//   private async seedExerciseAlternatives() {
//     console.log('Seeding exercise alternatives...');
//     const alternativeRepository = this.dataSource.getRepository(ExerciseAlternative);
    
//     const alternatives = [];
//     for (const exercise of this.exercises) {
//       if (faker.datatype.boolean({ probability: 0.3 })) {
//         const alternative = new ExerciseAlternative();
//         alternative.baseExercise = exercise;
//         alternative.alternativeExercise = faker.helpers.arrayElement(
//           this.exercises.filter(e => e.id !== exercise.id && e.category.id === exercise.category.id)
//         );
//         alternative.reason = faker.lorem.sentence();
        
//         alternatives.push(alternative);
//       }
//     }
    
//     await alternativeRepository.save(alternatives);
//   }

//   private async seedWorkouts() {
//     console.log('Seeding workouts...');
//     const workoutRepository = this.dataSource.getRepository(Workout);
    
//     const workoutNames = [
//       'Push Day', 'Pull Day', 'Leg Day', 'Upper Body', 'Lower Body',
//       'Full Body', 'Cardio Day', 'Core Focus', 'Arm Day', 'Chest & Back',
//       'Back & Biceps', 'Chest & Triceps', 'Shoulders & Abs', 'Legs & Glutes',
//       'HIIT Circuit', 'Strength Training', 'Endurance Workout', 'Power Building'
//     ];
    
//     this.workouts = [];
//     for (const name of workoutNames) {
//       const workout = new Workout();
//       workout.name = name;
//       workout.coach = faker.helpers.arrayElement(this.coaches);
//       workout.isGlobal = faker.datatype.boolean();
      
//       this.workouts.push(workout);
//     }
    
//     await workoutRepository.save(this.workouts);
//   }

//   private async seedWorkoutExercises() {
//     console.log('Seeding workout exercises...');
//     const workoutExerciseRepository = this.dataSource.getRepository(WorkoutExercise);
    
//     const workoutExercises = [];
//     for (const workout of this.workouts) {
//       const numExercises = faker.number.int({ min: 4, max: 8 });
//       const selectedExercises = faker.helpers.arrayElements(this.exercises, numExercises);
      
//       for (const exercise of selectedExercises) {
//         const workoutExercise = new WorkoutExercise();
//         workoutExercise.workout = workout;
//         workoutExercise.exercise = exercise;
//         workoutExercise.sets = faker.number.int({ min: 3, max: 5 });
//         workoutExercise.reps = faker.number.int({ min: 8, max: 15 });
//         workoutExercise.rpe = faker.number.int({ min: 6, max: 10 });
//         workoutExercise.restSec = faker.number.int({ min: 45, max: 90 });
//         workoutExercise.tempo = `${faker.number.int({ min: 1, max: 3 })}/${faker.number.int({ min: 1, max: 3 })}/${faker.number.int({ min: 1, max: 3 })}`;
//         workoutExercise.notes = faker.lorem.sentence();
        
//         workoutExercises.push(workoutExercise);
//       }
//     }
    
//     await workoutExerciseRepository.save(workoutExercises);
//   }

//   private async seedProgramTemplates() {
//     console.log('Seeding program templates...');
//     const programTemplateRepository = this.dataSource.getRepository(ProgramTemplate);
    
//     const templateNames = [
//       'Beginner Strength', 'Intermediate Hypertrophy', 'Advanced Powerlifting',
//       'Fat Loss', 'Muscle Building', 'Maintenance', 'Competition Prep',
//       'Bodyweight Only', 'Home Workout', 'Gym Program', 'Bulking Phase',
//       'Cutting Phase', 'Strength & Conditioning', 'Functional Fitness'
//     ];
    
//     this.programTemplates = [];
//     for (const name of templateNames) {
//       const programTemplate = new ProgramTemplate();
//       programTemplate.coach = faker.helpers.arrayElement(this.coaches);
//       programTemplate.name = name;
//       programTemplate.meta = {
//         warmup: faker.helpers.arrayElement(['10m dynamic stretching', '5m cardio', '15m mobility work']),
//         cooldown: faker.helpers.arrayElement(['5m static stretching', '10m foam rolling', '5m deep breathing']),
//         restRange: [faker.number.int({ min: 60, max: 90 }), faker.number.int({ min: 90, max: 120 })],
//         tempoDefault: `${faker.number.int({ min: 1, max: 3 })}/${faker.number.int({ min: 1, max: 3 })}/${faker.number.int({ min: 1, max: 3 })}`,
//         frequency: faker.helpers.arrayElement(['3 days/week', '4 days/week', '5 days/week', '6 days/week']),
//         duration: faker.helpers.arrayElement(['4 weeks', '6 weeks', '8 weeks', '12 weeks'])
//       };
//       programTemplate.createdAt = faker.date.past();
      
//       this.programTemplates.push(programTemplate);
//     }
    
//     await programTemplateRepository.save(this.programTemplates);
//   }

//   private async seedProgramTemplateDays() {
//     console.log('Seeding program template days...');
//     const programTemplateDayRepository = this.dataSource.getRepository(ProgramTemplateDay);
    
//     const programTemplateDays = [];
//     const dayLabels = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Rest', 'Cardio', 'Active Recovery'];
    
//     for (const template of this.programTemplates) {
//       const numDays = faker.number.int({ min: 3, max: 7 });
      
//       for (let i = 0; i < numDays; i++) {
//         const programTemplateDay = new ProgramTemplateDay();
//         programTemplateDay.template = template;
//         programTemplateDay.dayIndex = i + 1;
//         programTemplateDay.label = faker.helpers.arrayElement(dayLabels);
        
//         if (programTemplateDay.label !== 'Rest' && programTemplateDay.label !== 'Cardio' && programTemplateDay.label !== 'Active Recovery') {
//           programTemplateDay.workout = faker.helpers.arrayElement(this.workouts);
//         }
        
//         if (programTemplateDay.label === 'Cardio' || faker.datatype.boolean({ probability: 0.3 })) {
//           programTemplateDay.cardio = {
//             type: faker.helpers.arrayElement(['walk', 'run', 'cycle', 'row', 'swim', 'elliptical']),
//             durationMin: faker.number.int({ min: 20, max: 60 }),
//             intensity: faker.helpers.arrayElement(['low', 'moderate', 'high']),
//             mode: faker.helpers.arrayElement(['steady', 'intervals', 'hills'])
//           };
//         }
        
//         if (faker.datatype.boolean({ probability: 0.4 })) {
//           programTemplateDay.stretching = {
//             dynamic: faker.number.int({ min: 3, max: 8 }),
//             static: faker.number.int({ min: 3, max: 8 }),
//             focus: faker.helpers.arrayElement(['full body', 'upper body', 'lower body', 'flexibility'])
//           };
//         }
        
//         programTemplateDays.push(programTemplateDay);
//       }
//     }
    
//     await programTemplateDayRepository.save(programTemplateDays);
//   }

//   private async seedAssignedPrograms() {
//     console.log('Seeding assigned programs...');
//     const assignedProgramRepository = this.dataSource.getRepository(AssignedProgram);
    
//     const assignedPrograms = [];
//     for (const client of this.clients) {
//       if (faker.datatype.boolean({ probability: 0.7 })) {
//         const assignedProgram = new AssignedProgram();
//         assignedProgram.user = client;
//         assignedProgram.template = faker.helpers.arrayElement(this.programTemplates);
//         assignedProgram.startDate = faker.date.recent();
//         assignedProgram.endDate = faker.date.future();
//         assignedProgram.active = faker.datatype.boolean();
        
//         assignedPrograms.push(assignedProgram);
//       }
//     }
    
//     await assignedProgramRepository.save(assignedPrograms);
//   }

//   private async seedWorkoutSetLogs() {
//     console.log('Seeding workout set logs...');
//     const workoutSetLogRepository = this.dataSource.getRepository(WorkoutSetLog);
    
//     const workoutSetLogs = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 5, max: 20 }); i++) {
//         const workoutSetLog = new WorkoutSetLog();
//         workoutSetLog.user = client;
//         workoutSetLog.exercise = faker.helpers.arrayElement(this.exercises);
//         workoutSetLog.weight = faker.number.float({ min: 10, max: 150, fractionDigits: 1 });
//         workoutSetLog.reps = faker.number.int({ min: 5, max: 15 });
//         workoutSetLog.tempo = `${faker.number.int({ min: 1, max: 3 })}/${faker.number.int({ min: 1, max: 3 })}/${faker.number.int({ min: 1, max: 3 })}`;
//         workoutSetLog.restSec = faker.number.int({ min: 45, max: 120 });
//         workoutSetLog.performedAt = faker.date.recent();
//         workoutSetLog.notes = faker.lorem.sentence();
        
//         workoutSetLogs.push(workoutSetLog);
//       }
//     }
    
//     await workoutSetLogRepository.save(workoutSetLogs);
//   }

//   private async seedCardioSessions() {
//     console.log('Seeding cardio sessions...');
//     const cardioSessionRepository = this.dataSource.getRepository(CardioSession);
    
//     const cardioSessions = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 3, max: 10 }); i++) {
//         const cardioSession = new CardioSession();
//         cardioSession.user = client;
//         cardioSession.type = faker.helpers.arrayElement(['walk', 'run', 'cycle', 'row', 'swim']);
//         cardioSession.intensity = faker.helpers.arrayElement(['steady', 'hiit', 'moderate']);
//         cardioSession.durationMin = faker.number.int({ min: 15, max: 60 });
//         cardioSession.performedAt = faker.date.recent();
//         cardioSession.notes = faker.lorem.sentence();
        
//         cardioSessions.push(cardioSession);
//       }
//     }
    
//     await cardioSessionRepository.save(cardioSessions);
//   }

//   private async seedFoods() {
//     console.log('Seeding foods...');
//     const foodRepository = this.dataSource.getRepository(Food);
    
//     const foodData = [
//       { name: 'Chicken Breast', calories: 165, protein: 31, carbs: 0, fat: 3.6, per: '100g' },
//       { name: 'Brown Rice', calories: 111, protein: 2.6, carbs: 23, fat: 0.9, per: '100g' },
//       { name: 'Broccoli', calories: 34, protein: 2.8, carbs: 7, fat: 0.4, per: '100g' },
//       { name: 'Salmon', calories: 208, protein: 20, carbs: 0, fat: 13, per: '100g' },
//       { name: 'Eggs', calories: 155, protein: 13, carbs: 1.1, fat: 11, per: '100g' },
//       { name: 'Oats', calories: 389, protein: 16.9, carbs: 66, fat: 6.9, per: '100g' },
//       { name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, per: '100g' },
//       { name: 'Almonds', calories: 579, protein: 21, carbs: 22, fat: 50, per: '100g' },
//       { name: 'Greek Yogurt', calories: 59, protein: 10, carbs: 3.6, fat: 0.4, per: '100g' },
//       { name: 'Sweet Potato', calories: 86, protein: 1.6, carbs: 20, fat: 0.1, per: '100g' },
//       { name: 'Whole Wheat Bread', calories: 247, protein: 13, carbs: 41, fat: 3.4, per: '100g' },
//       { name: 'Tuna', calories: 132, protein: 29, carbs: 0, fat: 1.3, per: '100g' },
//       { name: 'Avocado', calories: 160, protein: 2, carbs: 9, fat: 15, per: '100g' },
//       { name: 'Cottage Cheese', calories: 98, protein: 11, carbs: 3.4, fat: 4.3, per: '100g' },
//       { name: 'Quinoa', calories: 120, protein: 4.4, carbs: 21, fat: 1.9, per: '100g' },
//       { name: 'Whey Protein', calories: 113, protein: 24, carbs: 2.9, fat: 1.1, per: '30g' },
//       { name: 'Apple', calories: 52, protein: 0.3, carbs: 14, fat: 0.2, per: '100g' },
//       { name: 'Spinach', calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, per: '100g' },
//       { name: 'Olive Oil', calories: 884, protein: 0, carbs: 0, fat: 100, per: '100g' },
//       { name: 'Beef', calories: 250, protein: 26, carbs: 0, fat: 17, per: '100g' },
//     ];
    
//     this.foods = foodData.map(foodData => {
//       const food = new Food();
//       Object.assign(food, foodData);
//       food.notes = faker.lorem.sentence();
//       return food;
//     });
    
//     await foodRepository.save(this.foods);
//   }

//   private async seedFoodSubstitutions() {
//     console.log('Seeding food substitutions...');
//     const foodSubstitutionRepository = this.dataSource.getRepository(FoodSubstitution);
    
//     const foodSubstitutions = [];
//     for (let i = 0; i < 10; i++) {
//       const baseFood = faker.helpers.arrayElement(this.foods);
//       const altFood = faker.helpers.arrayElement(this.foods.filter(f => f.id !== baseFood.id));
      
//       const foodSubstitution = new FoodSubstitution();
//       foodSubstitution.baseFood = baseFood;
//       foodSubstitution.altFood = altFood;
//       foodSubstitution.baseQty = faker.number.int({ min: 50, max: 200 });
//       foodSubstitution.altQty = faker.number.int({ min: 50, max: 200 });
//       foodSubstitution.unit = faker.helpers.arrayElement(['g', 'ml', 'cup', 'tbsp']);
      
//       foodSubstitutions.push(foodSubstitution);
//     }
    
//     await foodSubstitutionRepository.save(foodSubstitutions);
//   }

//   private async seedMeals() {
//     console.log('Seeding meals...');
//     const mealRepository = this.dataSource.getRepository(Meal);
    
//     const mealNames = [
//       'Breakfast', 'Lunch', 'Dinner', 'Snack 1', 'Snack 2',
//       'Pre-workout', 'Post-workout', 'Bedtime', 'Morning Snack', 'Afternoon Snack'
//     ];
    
//     this.meals = [];
//     for (const name of mealNames) {
//       const meal = new Meal();
//       meal.name = name;
//       meal.coach = faker.helpers.arrayElement(this.coaches);
      
//       this.meals.push(meal);
//     }
    
//     await mealRepository.save(this.meals);
//   }

//   private async seedMealItems() {
//     console.log('Seeding meal items...');
//     const mealItemRepository = this.dataSource.getRepository(MealItem);
    
//     const mealItems = [];
//     for (const meal of this.meals) {
//       const numItems = faker.number.int({ min: 2, max: 5 });
//       const selectedFoods = faker.helpers.arrayElements(this.foods, numItems);
      
//       for (const food of selectedFoods) {
//         const mealItem = new MealItem();
//         mealItem.meal = meal;
//         mealItem.food = food;
//         mealItem.qty = faker.number.int({ min: 50, max: 200 });
//         mealItem.unit = 'g';
//         mealItem.note = faker.lorem.sentence();
        
//         mealItems.push(mealItem);
//       }
//     }
    
//     await mealItemRepository.save(mealItems);
//   }

//   private async seedDietPlanTemplates() {
//     console.log('Seeding diet plan templates...');
//     const dietPlanTemplateRepository = this.dataSource.getRepository(DietPlanTemplate);
    
//     const templateNames = [
//       'Weight Loss', 'Muscle Gain', 'Maintenance', 
//       'Keto', 'Low Carb', 'High Protein', 'Balanced',
//       'Vegetarian', 'Mediterranean', 'High Calorie', 'Low Calorie'
//     ];
    
//     this.dietPlanTemplates = [];
//     for (const name of templateNames) {
//       const dietPlanTemplate = new DietPlanTemplate();
//       dietPlanTemplate.coach = faker.helpers.arrayElement(this.coaches);
//       dietPlanTemplate.name = name;
//       dietPlanTemplate.macros = {
//         calories: faker.number.int({ min: 1500, max: 3000 }),
//         protein: faker.number.int({ min: 100, max: 200 }),
//         carbs: faker.number.int({ min: 100, max: 400 }),
//         fat: faker.number.int({ min: 40, max: 100 })
//       };
//       dietPlanTemplate.meals = faker.helpers.arrayElements(this.meals, faker.number.int({ min: 3, max: 6 }));
//       dietPlanTemplate.rules = {
//         substitutionsAllowed: faker.datatype.boolean(),
//         waterTargetL: faker.number.int({ min: 2, max: 4 }),
//         supplements: faker.helpers.arrayElements(['Multivitamin', 'Protein Powder', 'Creatine', 'Omega-3', 'Vitamin D', 'Zinc'], 3),
//         mealTiming: faker.helpers.arrayElement(['3 meals + 2 snacks', '6 small meals', 'Intermittent fasting']),
//         cheatMeals: faker.number.int({ min: 0, max: 2 }) + ' per week'
//       };
//       dietPlanTemplate.createdAt = faker.date.past();
      
//       this.dietPlanTemplates.push(dietPlanTemplate);
//     }
    
//     await dietPlanTemplateRepository.save(this.dietPlanTemplates);
//   }

//   private async seedAssignedDiets() {
//     console.log('Seeding assigned diets...');
//     const assignedDietRepository = this.dataSource.getRepository(AssignedDiet);
    
//     const assignedDiets = [];
//     for (const client of this.clients) {
//       if (faker.datatype.boolean({ probability: 0.6 })) {
//         const assignedDiet = new AssignedDiet();
//         assignedDiet.user = client;
//         assignedDiet.template = faker.helpers.arrayElement(this.dietPlanTemplates);
//         assignedDiet.active = faker.datatype.boolean();
//         assignedDiet.startDate = faker.date.recent();
//         assignedDiet.endDate = faker.date.future();
        
//         assignedDiets.push(assignedDiet);
//       }
//     }
    
//     await assignedDietRepository.save(assignedDiets);
//   }

//   private async seedMealLogs() {
//     console.log('Seeding meal logs...');
//     const mealLogRepository = this.dataSource.getRepository(MealLog);
    
//     const mealLogs = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 10, max: 30 }); i++) {
//         const mealLog = new MealLog();
//         mealLog.user = client;
//         mealLog.meal = faker.helpers.arrayElement(this.meals);
//         mealLog.date = faker.date.recent();
//         mealLog.completed = faker.datatype.boolean();
        
//         if (mealLog.completed && faker.datatype.boolean({ probability: 0.3 })) {
//           mealLog.substitutions = {
//             original: faker.helpers.arrayElement(this.foods).name,
//             substitutedWith: faker.helpers.arrayElement(this.foods).name,
//             reason: faker.lorem.sentence()
//           };
//         }
        
//         mealLogs.push(mealLog);
//       }
//     }
    
//     await mealLogRepository.save(mealLogs);
//   }

//   private async seedWaterIntake() {
//     console.log('Seeding water intake...');
//     const waterIntakeRepository = this.dataSource.getRepository(WaterIntake);
    
//     const waterIntakes = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 7, max: 14 }); i++) {
//         const waterIntake = new WaterIntake();
//         waterIntake.user = client;
//         waterIntake.date = faker.date.recent();
//         waterIntake.liters = faker.number.float({ min: 1.5, max: 4, fractionDigits: 1 });
        
//         waterIntakes.push(waterIntake);
//       }
//     }
    
//     await waterIntakeRepository.save(waterIntakes);
//   }

//   private async seedSupplementLogs() {
//     console.log('Seeding supplement logs...');
//     const supplementLogRepository = this.dataSource.getRepository(SupplementLog);
    
//     const supplementLogs = [];
//     const supplementNames = ['Creatine', 'Omega-3', 'Multivitamin', 'Protein Powder', 'Vitamin D', 'Zinc', 'Magnesium', 'BCAA'];
    
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 5, max: 15 }); i++) {
//         const supplementLog = new SupplementLog();
//         supplementLog.user = client;
//         supplementLog.name = faker.helpers.arrayElement(supplementNames);
//         supplementLog.dose = faker.helpers.arrayElement(['5g', '1000mg', '1 capsule', '1 scoop', '2 tablets']);
//         supplementLog.date = faker.date.recent();
        
//         supplementLogs.push(supplementLog);
//       }
//     }
    
//     await supplementLogRepository.save(supplementLogs);
//   }

//   private async seedProgress() {
//     console.log('Seeding progress...');
//     const progressRepository = this.dataSource.getRepository(Progress);
    
//     const progresses = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 2, max: 5 }); i++) {
//         const progress = new Progress();
//         progress.user = client;
//         progress.weight = faker.number.float({ min: 50, max: 120, fractionDigits: 1 });
//         progress.chest = faker.number.float({ min: 80, max: 120, fractionDigits: 1 });
//         progress.waist = faker.number.float({ min: 60, max: 110, fractionDigits: 1 });
//         progress.arms = faker.number.float({ min: 25, max: 45, fractionDigits: 1 });
//         progress.thighs = faker.number.float({ min: 45, max: 75, fractionDigits: 1 });
//         progress.photoFrontUrl = faker.image.url();
//         progress.photoBackUrl = faker.image.url();
//         progress.date = faker.date.recent();
        
//         progresses.push(progress);
//       }
//     }
    
//     await progressRepository.save(progresses);
//   }

//   private async seedSleepLogs() {
//     console.log('Seeding sleep logs...');
//     const sleepLogRepository = this.dataSource.getRepository(SleepLog);
    
//     const sleepLogs = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 7, max: 14 }); i++) {
//         const sleepLog = new SleepLog();
//         sleepLog.user = client;
//         sleepLog.date = faker.date.recent();
//         sleepLog.hours = faker.number.float({ min: 4, max: 10, fractionDigits: 1 });
//         sleepLog.quality = faker.number.int({ min: 1, max: 5 });
        
//         sleepLogs.push(sleepLog);
//       }
//     }
    
//     await sleepLogRepository.save(sleepLogs);
//   }

//   private async seedStepsLogs() {
//     console.log('Seeding steps logs...');
//     const stepsLogRepository = this.dataSource.getRepository(StepsLog);
    
//     const stepsLogs = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 7, max: 14 }); i++) {
//         const stepsLog = new StepsLog();
//         stepsLog.user = client;
//         stepsLog.date = faker.date.recent();
//         stepsLog.steps = faker.number.int({ min: 3000, max: 15000 });
        
//         stepsLogs.push(stepsLog);
//       }
//     }
    
//     await stepsLogRepository.save(stepsLogs);
//   }

//   private async seedWeeklyCheckins() {
//     console.log('Seeding weekly checkins...');
//     const weeklyCheckinRepository = this.dataSource.getRepository(WeeklyCheckin);
    
//     const weeklyCheckins = [];
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 2, max: 5 }); i++) {
//         const weeklyCheckin = new WeeklyCheckin();
//         weeklyCheckin.user = client;
//         weeklyCheckin.weekStart = faker.date.recent();
//         weeklyCheckin.answers = {
//           hunger: faker.number.int({ min: 1, max: 5 }),
//           energy: faker.number.int({ min: 1, max: 5 }),
//           motivation: faker.number.int({ min: 1, max: 5 }),
//           stress: faker.number.int({ min: 1, max: 5 }),
//           sleepQuality: faker.number.int({ min: 1, max: 5 }),
//           workoutAdherence: faker.number.int({ min: 1, max: 5 }),
//           dietAdherence: faker.number.int({ min: 1, max: 5 }),
//           challenges: faker.lorem.sentence(),
//           successes: faker.lorem.sentence(),
//           notes: faker.lorem.paragraph()
//         };
//         weeklyCheckin.submitted = faker.datatype.boolean();
//         weeklyCheckin.createdAt = faker.date.recent();
        
//         weeklyCheckins.push(weeklyCheckin);
//       }
//     }
    
//     await weeklyCheckinRepository.save(weeklyCheckins);
//   }

//   private async seedWeeklyAnalyses() {
//     console.log('Seeding weekly analyses...');
//     const weeklyAnalysisRepository = this.dataSource.getRepository(WeeklyAnalysis);
//     const weeklyCheckinRepository = this.dataSource.getRepository(WeeklyCheckin);
    
//     const weeklyCheckins = await weeklyCheckinRepository.find();
//     const weeklyAnalyses = [];
    
//     for (const checkin of weeklyCheckins) {
//       if (faker.datatype.boolean({ probability: 0.7 })) {
//         const weeklyAnalysis = new WeeklyAnalysis();
//         weeklyAnalysis.checkin = checkin;
//         weeklyAnalysis.highlights = {
//           positives: [faker.lorem.sentence(), faker.lorem.sentence()],
//           concerns: [faker.lorem.sentence()],
//           trends: {
//             weight: faker.helpers.arrayElement(['stable', 'decreasing', 'increasing']),
//             energy: faker.helpers.arrayElement(['stable', 'improving', 'declining']),
//             adherence: faker.helpers.arrayElement(['excellent', 'good', 'needs improvement'])
//           }
//         };
//         weeklyAnalysis.metrics = {
//           avgCalories: faker.number.int({ min: 1500, max: 3000 }),
//           avgProtein: faker.number.int({ min: 80, max: 180 }),
//           avgCarbs: faker.number.int({ min: 100, max: 350 }),
//           avgFat: faker.number.int({ min: 40, max: 100 }),
//           avgSteps: faker.number.int({ min: 5000, max: 12000 }),
//           avgSleepHours: faker.number.float({ min: 6, max: 9, fractionDigits: 1 }),
//           workoutCompletion: faker.number.int({ min: 50, max: 100 }) + '%'
//         };
//         weeklyAnalysis.coachNotes = faker.lorem.paragraph();
        
//         weeklyAnalyses.push(weeklyAnalysis);
//       }
//     }
    
//     await weeklyAnalysisRepository.save(weeklyAnalyses);
//   }

//   private async seedFormTemplates() {
//     console.log('Seeding form templates...');
//     const formTemplateRepository = this.dataSource.getRepository(FormTemplate);
    
//     const formTemplates = [];
//     const templateNames = ['Onboarding', 'Health Assessment', 'Goal Setting', 'Progress Review', 'Satisfaction Survey'];
    
//     for (const name of templateNames) {
//       const formTemplate = new FormTemplate();
//       formTemplate.coach = faker.helpers.arrayElement(this.coaches);
//       formTemplate.name = name;
//       formTemplate.questions = [
//         {
//           key: 'goal',
//           type: 'select',
//           question: 'What is your primary goal?',
//           options: ['Weight Loss', 'Muscle Gain', 'Maintenance', 'Improve Health', 'Prepare for Event']
//         },
//         {
//           key: 'experience',
//           type: 'select',
//           question: 'What is your fitness experience level?',
//           options: ['Beginner', 'Intermediate', 'Advanced']
//         },
//         {
//           key: 'injuries',
//           type: 'text',
//           question: 'Do you have any injuries or health conditions we should know about?'
//         },
//         {
//           key: 'preferences',
//           type: 'multiselect',
//           question: 'What types of exercise do you enjoy?',
//           options: ['Weight Training', 'Cardio', 'Yoga', 'Swimming', 'Cycling', 'Running']
//         }
//       ];
//       formTemplate.createdAt = faker.date.past();
      
//       formTemplates.push(formTemplate);
//     }
    
//     await formTemplateRepository.save(formTemplates);
//   }

//   private async seedFormResponses() {
//     console.log('Seeding form responses...');
//     const formResponseRepository = this.dataSource.getRepository(FormResponse);
//     const formTemplateRepository = this.dataSource.getRepository(FormTemplate);
    
//     const formTemplates = await formTemplateRepository.find();
//     const formResponses = [];
    
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 1, max: 3 }); i++) {
//         const formResponse = new FormResponse();
//         formResponse.user = client;
//         formResponse.template = faker.helpers.arrayElement(formTemplates);
//         formResponse.answers = {
//           goal: faker.helpers.arrayElement(['Weight Loss', 'Muscle Gain', 'Maintenance', 'Improve Health', 'Prepare for Event']),
//           experience: faker.helpers.arrayElement(['Beginner', 'Intermediate', 'Advanced']),
//           injuries: faker.lorem.sentence(),
//           preferences: faker.helpers.arrayElements(['Weight Training', 'Cardio', 'Yoga', 'Swimming', 'Cycling', 'Running'], 3)
//         };
//         formResponse.createdAt = faker.date.past();
        
//         formResponses.push(formResponse);
//       }
//     }
    
//     await formResponseRepository.save(formResponses);
//   }

//   private async seedMessages() {
//     console.log('Seeding messages...');
//     const messageRepository = this.dataSource.getRepository(Message);
    
//     const messages = [];
    
//     // Direct messages between coaches and clients
//     for (const coach of this.coaches) {
//       const coachClients = this.clients.filter(client => client.coach?.id === coach.id);
      
//       for (const client of coachClients) {
//         for (let i = 0; i < faker.number.int({ min: 3, max: 8 }); i++) {
//           const message = new Message();
//           message.from = faker.datatype.boolean() ? coach : client;
//           message.to = message.from.id === coach.id ? client : coach;
//           message.body = faker.lorem.paragraph();
//           message.type = 'direct';
//           message.createdAt = faker.date.recent();
          
//           messages.push(message);
//         }
//       }
//     }
    
//     // Broadcast messages from coaches
//     for (const coach of this.coaches) {
//       for (let i = 0; i < faker.number.int({ min: 1, max: 3 }); i++) {
//         const message = new Message();
//         message.from = coach;
//         message.to = null; // Broadcast
//         message.body = faker.lorem.paragraph();
//         message.type = 'broadcast';
//         message.createdAt = faker.date.recent();
        
//         messages.push(message);
//       }
//     }
    
//     await messageRepository.save(messages);
//   }

//   private async seedNotifications() {
//     console.log('Seeding notifications...');
//     const notificationRepository = this.dataSource.getRepository(Notification);
    
//     const notifications = [];
//     const notificationTitles = [
//       'New Workout Assigned', 
//       'Diet Plan Updated', 
//       'Weekly Check-in Reminder',
//       'Message Received',
//       'Progress Report Ready',
//       'Payment Received',
//       'Subscription Expiring Soon'
//     ];
    
//     for (const client of this.clients) {
//       for (let i = 0; i < faker.number.int({ min: 3, max: 10 }); i++) {
//         const notification = new Notification();
//         notification.user = client;
//         notification.title = faker.helpers.arrayElement(notificationTitles);
//         notification.message = faker.lorem.sentence();
//         notification.meta = {
//           channel: faker.helpers.arrayElement(['app', 'email', 'push']),
//           actionUrl: faker.internet.url(),
//           priority: faker.helpers.arrayElement(['low', 'medium', 'high'])
//         };
//         notification.read = faker.datatype.boolean();
//         notification.createdAt = faker.date.recent();
        
//         notifications.push(notification);
//       }
//     }
    
//     await notificationRepository.save(notifications);
//   }

//   private async seedStaffTasks() {
//     console.log('Seeding staff tasks...');
//     const staffTaskRepository = this.dataSource.getRepository(StaffTask);
    
//     const staffTasks = [];
//     const taskTitles = [
//       'Follow up with client', 
//       'Review nutrition plan', 
//       'Create new workout program',
//       'Check progress photos',
//       'Update client measurements',
//       'Respond to messages',
//       'Prepare weekly report'
//     ];
    
//     for (const coach of this.coaches) {
//       for (let i = 0; i < faker.number.int({ min: 3, max: 8 }); i++) {
//         const staffTask = new StaffTask();
//         staffTask.creator = faker.helpers.arrayElement(this.coaches);
//         staffTask.assignee = coach;
//         staffTask.title = faker.helpers.arrayElement(taskTitles);
//         staffTask.description = faker.lorem.paragraph();
//         staffTask.status = faker.helpers.arrayElement(['open', 'in_progress', 'done']);
//         staffTask.dueDate = faker.date.future();
//         staffTask.createdAt = faker.date.past();
        
//         staffTasks.push(staffTask);
//       }
//     }
    
//     await staffTaskRepository.save(staffTasks);
//   }

//   private async seedAuditLogs() {
//     console.log('Seeding audit logs...');
//     const auditLogRepository = this.dataSource.getRepository(AuditLog);
    
//     const auditLogs = [];
//     const actions = ['create', 'update', 'delete'];
//     const entities = ['User', 'Workout', 'Program', 'Diet', 'Progress'];
    
//     for (const user of [...this.coaches, ...this.users.filter(u => u.role.name === 'admin')]) {
//       for (let i = 0; i < faker.number.int({ min: 5, max: 15 }); i++) {
//         const auditLog = new AuditLog();
//         auditLog.actor = user;
//         auditLog.action = faker.helpers.arrayElement(actions);
//         auditLog.entity = faker.helpers.arrayElement(entities);
//         auditLog.entityId = faker.number.int({ min: 1, max: 100 });
//         auditLog.diff = {
//           before: { someField: faker.lorem.word() },
//           after: { someField: faker.lorem.word() }
//         };
//         auditLog.createdAt = faker.date.recent();
        
//         auditLogs.push(auditLog);
//       }
//     }
    
//     await auditLogRepository.save(auditLogs);
//   }
// }

// // How to use this seeder
// export async function runSeeder(dataSource: DataSource) {
//   const seeder = new CompleteSeeder(dataSource);
//   await seeder.seed();
// }