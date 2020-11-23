//Schema of the response metadata of the TaxiConnect pricing service.
//Cars categories: Economy, Comfort, Luxury, 7seaters
//Comfort level : 1 (normal taxis), 2 (comfort normal cars), 3 (Luxury normal cars), 4 (comfort 7seaters), 5 (luxury 7seaters)(extremely comfortable)

[
	//Economy
	{
		category: 'Economy',
		country: 'Namibia',
		city: 'Windhoek',
		base_fare: 12,
		comfort_level: 1,
		car_type: 'normalTaxiEconomy',
		app_label: 'Normal Taxi',
		fuel_type: ['Petrol'],
		airport_rides: false,	//Whether the car can be used to go to airports
		exception_airport: ['Eros Airport'],	//Airport that they can ride to
		media: {
			car_app_icon: '../images_res/normaltaxieconomy.jpg'
		}
	},
	{
		category: 'Economy',
		country: 'Namibia',
		city: 'Windhoek',
		base_fare: 12,
		comfort_level: 1,
		car_type: 'electricEconomy',
		app_label: 'Electric car',
		fuel_type: ['Electric'],
		airport_rides: true,	//Whether the car can be used to go to airports
		exception_airport: ['Eros Airport'],	//Airport that they can ride to
		media: {
			car_app_icon: '../images_res/electricEconomy.jpg'
		}
	},
	//Comfort
	{
		category: 'Comfort',
		country: 'Namibia',
		city: 'Windhoek',
		base_fare: 50,
		comfort_level: 2,
		car_type: 'comfortRide',
		app_label: 'Mercedes Benz',
		fuel_type: ['Petrol'],
		airport_rides: true,	//Whether the car can be used to go to airports
		exception_airport: ['Eros Airport'],	//Airport that they can ride to
		media: {
			car_app_icon: '../images_res/comfortrideMercedes.jpg'
		}
	},
	{
		category: 'Comfort',
		country: 'Namibia',
		city: 'Windhoek',
		base_fare: 50,
		comfort_level: 2,
		car_type: 'comfortRide',
		app_label: 'Golf 7',
		fuel_type: ['Petrol'],
		airport_rides: true,	//Whether the car can be used to go to airports
		exception_airport: ['Eros Airport'],	//Airport that they can ride to
		media: {
			car_app_icon: '../images_res/comfortrideGolf.jpg'
		}
	}
	//Luxury
	{
		category: 'Luxury',
		country: 'Namibia',
		city: 'Windhoek',
		base_fare: 190,
		comfort_level: 3,
		car_type: 'luxuryRide',
		app_label: 'Mercedes Brabus',
		fuel_type: ['Petrol'],
		airport_rides: true,	//Whether the car can be used to go to airports
		exception_airport: ['Eros Airport'],	//Airport that they can ride to
		media: {
			car_app_icon: '../images_res/luxuryRideBrabus.jpg'
		}
	},
	{
		category: 'Luxury',
		country: 'Namibia',
		city: 'Windhoek',
		base_fare: 250,
		comfort_level: 3,
		car_type: 'luxuryRide',
		app_label: 'G Wagon',
		fuel_type: ['Petrol'],
		airport_rides: true,	//Whether the car can be used to go to airports
		exception_airport: ['Eros Airport'],	//Airport that they can ride to
		media: {
			car_app_icon: '../images_res/luxuryRideGWagon.jpg'
		}
	}
]