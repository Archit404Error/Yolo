from flask import Flask, jsonify, request
import mysql.connector
import requests

app = Flask(__name__)

mydb = mysql.connector.connect(
  host="sql5.freesqldatabase.com",
  user="sql5432499",
  password="Lp5Tw8l2GR",
  database="sql5432499",
  autocommit = True
 )

cursor = mydb.cursor()

@app.route('/query')
def queryDB():
    cursor.execute("SELECT * FROM Events")
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)

@app.route('/queryId')
def idRes():
    cursor.execute("SELECT COUNT(id) FROM Events")
    res = cursor.fetchall()
    return jsonify(res[0][0])

@app.route('/addEvent')
def createEvent():
    params = list(request.args)
    sql = "INSERT into Events(image, title, description, location, other) VALUES {}, {}, {}, {}, {}".format(params[0], params[1], params[2], params[3], params[4])
    cursor.execute(sql)
    return jsonify(True)

@app.route('/getChats')
def returnChats():
    sql = 'SELECT * FROM Chats WHERE id={}'.format(list(request.args)[0])
    cursor.execute(sql)
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)

if __name__ == "__main__":
    app.run(debug=True)
