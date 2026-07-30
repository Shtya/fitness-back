import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

const ENDPOINTS = [
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass-api.de/api/interpreter',
];

@Injectable()
export class FitnessOsmService {
	private readonly logger = new Logger(FitnessOsmService.name);

	async search(lat: number, lng: number, cityName: string, radiusKm = 15) {
		const dLat = radiusKm / 111;
		const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
		const south = lat - dLat;
		const west = lng - dLng;
		const north = lat + dLat;
		const east = lng + dLng;
		const query = `[out:json][timeout:25];(node["leisure"="fitness_centre"](${south},${west},${north},${east});node["amenity"="gym"](${south},${west},${north},${east});way["leisure"="fitness_centre"](${south},${west},${north},${east});way["amenity"="gym"](${south},${west},${north},${east}););out center tags;`;

		for (const endpoint of ENDPOINTS) {
			try {
				const { data } = await axios.get(endpoint, {
					params: { data: query },
					timeout: 40000,
					headers: { Accept: 'application/json' },
				});
				return (data.elements || []).map((el: any) => this.normalize(el, cityName));
			} catch (error: any) {
				this.logger.warn(`OSM ${endpoint} failed: ${error?.message || error}`);
			}
		}
		return [];
	}

	private normalize(el: any, cityName: string) {
		const tags = el.tags || {};
		const lat = el.lat ?? el.center?.lat;
		const lng = el.lon ?? el.center?.lon;
		const name = tags.name || tags['name:en'] || tags['name:ar'] || 'Business';
		const neighborhood =
			tags['addr:suburb'] ||
			tags['addr:neighbourhood'] ||
			tags['addr:neighborhood'] ||
			tags['addr:district'] ||
			tags['addr:quarter'] ||
			'';
		const addressParts = [
			tags['addr:housenumber'],
			tags['addr:street'],
			neighborhood,
			tags['addr:city'] || cityName,
			tags['addr:country'],
		].filter(Boolean);

		const asUrl = (raw: string, base: string) => {
			const v = String(raw || '').trim();
			if (!v) return '';
			if (/^https?:\/\//i.test(v)) return v;
			if (v.includes('.')) return `https://${v.replace(/^\/\//, '')}`;
			return `${base}${v.replace(/^@/, '')}`;
		};

		return {
			id: `osm-${el.type}-${el.id}`,
			displayName: { text: name },
			formattedAddress: addressParts.join(', '),
			shortFormattedAddress: neighborhood || addressParts[0] || '',
			addressComponents: neighborhood
				? [{ longText: neighborhood, types: ['neighborhood'] }]
				: [],
			websiteUri: tags.website || tags['contact:website'] || '',
			internationalPhoneNumber: tags.phone || tags['contact:phone'] || '',
			googleMapsUri:
				lat && lng
					? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
					: '',
			_osmSocial: {
				instagram: asUrl(tags['contact:instagram'], 'https://instagram.com/'),
				facebook: asUrl(tags['contact:facebook'], 'https://facebook.com/'),
				twitter: asUrl(tags['contact:twitter'] || tags['contact:x'], 'https://x.com/'),
				youtube: asUrl(tags['contact:youtube'], 'https://youtube.com/'),
				whatsapp: asUrl(tags['contact:whatsapp'], 'https://wa.me/'),
				linkedin: asUrl(tags['contact:linkedin'], 'https://linkedin.com/company/'),
			},
			_source: 'osm',
		};
	}
}
