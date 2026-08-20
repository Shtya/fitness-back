import { extractWhatsAppLocation } from './whatsapp-location';

describe('extractWhatsAppLocation', () => {
	it('reads Baileys locationMessage coordinates', () => {
		const location = extractWhatsAppLocation({
			type: 'location',
			raw: {
				message: {
					locationMessage: {
						degreesLatitude: 30.0444,
						degreesLongitude: 31.2357,
						name: 'Cairo',
						address: 'Tahrir Square',
					},
				},
			},
		});
		expect(location).toMatchObject({
			latitude: 30.0444,
			longitude: 31.2357,
			name: 'Cairo',
			address: 'Tahrir Square',
			isLive: false,
		});
	});

	it('reads a stored CRM location payload on raw.location', () => {
		const location = extractWhatsAppLocation({
			type: 'location',
			raw: {
				location: {
					latitude: 30.0444,
					longitude: 31.2357,
					name: 'Cairo',
				},
			},
		});
		expect(location).toMatchObject({
			latitude: 30.0444,
			longitude: 31.2357,
			name: 'Cairo',
		});
	});

	it('reads live location captions', () => {
		const location = extractWhatsAppLocation({
			raw: {
				message: {
					liveLocationMessage: {
						degreesLatitude: 29.98,
						degreesLongitude: 31.13,
						caption: 'On the way',
					},
				},
			},
		});
		expect(location).toMatchObject({
			latitude: 29.98,
			longitude: 31.13,
			name: 'On the way',
			isLive: true,
		});
	});

	it('reads protobuf Long and {value} coordinate wrappers', () => {
		const location = extractWhatsAppLocation({
			type: 'location',
			raw: {
				message: {
					locationMessage: {
						degreesLatitude: { value: 30.0444 },
						degreesLongitude: { low: 31, high: 0, unsigned: false },
					},
				},
			},
		});
		expect(location).toMatchObject({
			latitude: 30.0444,
			longitude: 31,
		});
	});
});
