const MongoClient = require('mongodb').MongoClient;
const assert = require('assert');

const url = "mongodb://localhost:27017";

const dbName = 'searched_locations_persist';

const client = new MongoClient(url, {useUnifiedTopology: true});

client.connect(function(err) {
	if(err) throw err;

	console.log('Connected successfully to the server.');

	const db = client.db(dbName);
	const collection = db.collection('documents');

	collection.find({}).toArray(function(err, result) {
		if(err) throw err;

		//console.log(result);
		var object = [{name: 'Anna', city: 'Windhoek'}];

		collection.insertMany(object, function(err, res) {
			//console.log(res);
			collection.find({}).toArray(function(err, res) {
				console.log(res);
			});
		});
	});

	//client.close();
});